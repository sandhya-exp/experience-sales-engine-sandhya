"use client";

import { useCallback, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { stagesFor, type AiProgressStage } from "@/lib/ai/progress";

/**
 * Progress for an agent-loop run the user chose to wait for.
 *
 * `useAiRun` streams POST /api/leads/[id]/ai and turns each stage line into
 * state; `AiProgress` draws the steps. The list is the real sequence the
 * orchestrator reports (see lib/ai/progress.ts), not a timer.
 */
export interface AiRunDone {
  ok: boolean;
  detail: string;
  applied?: string[];
  resolvedGaps?: string[];
  readinessBefore?: string | null;
  readinessAfter?: string | null;
  nextAction?: string | null;
  duration_ms?: number;
}

export function useAiRun(leadId: string) {
  const [stage, setStage] = useState<AiProgressStage | null>(null);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(
    async (body: { op: "refresh" } | { op: "reply"; text: string; inReplyTo?: string | null }): Promise<AiRunDone> => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setRunning(true);
      setStage(null);
      setStartedAt(Date.now());
      try {
        const res = await fetch(`/api/leads/${leadId}/ai`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          return { ok: false, detail: (j as { error?: string }).error ?? `Request failed (${res.status}).` };
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done: AiRunDone | null = null;
        for (;;) {
          const { value, done: eof } = await reader.read();
          if (eof) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            const msg = JSON.parse(line) as { stage?: AiProgressStage; done?: boolean } & Partial<AiRunDone>;
            if (msg.stage) setStage(msg.stage);
            if (msg.done) done = { ok: Boolean(msg.ok), detail: msg.detail ?? "", applied: msg.applied, resolvedGaps: msg.resolvedGaps, readinessBefore: msg.readinessBefore, readinessAfter: msg.readinessAfter, nextAction: msg.nextAction, duration_ms: msg.duration_ms };
          }
        }
        return done ?? { ok: false, detail: "The connection closed before the AI finished." };
      } catch (err) {
        if ((err as Error).name === "AbortError") return { ok: false, detail: "Cancelled." };
        return { ok: false, detail: err instanceof Error ? err.message : "The AI run failed." };
      } finally {
        setRunning(false);
      }
    },
    [leadId]
  );

  return { run, stage, running, startedAt };
}

export function AiProgress({ op, stage, className }: { op: "refresh" | "reply"; stage: AiProgressStage | null; className?: string }) {
  const steps = stagesFor(op);
  const idx = stage ? steps.findIndex((s) => s.key === stage) : -1;
  return (
    <ol className={cn("flex flex-wrap items-center gap-x-1 gap-y-1 text-[12px]", className)} aria-live="polite" aria-label="AI progress">
      {steps.map((s, i) => {
        const done = i < idx;
        const current = i === idx;
        return (
          <li key={s.key} className="flex items-center">
            <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5", current ? "bg-navy/10 font-medium text-navy" : done ? "text-success" : "text-muted-foreground/70")}>
              {done ? <Check className="h-3 w-3" /> : current ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-50" />}
              {s.label}
            </span>
            {i < steps.length - 1 && <span className="mx-0.5 text-muted-foreground/50">→</span>}
          </li>
        );
      })}
    </ol>
  );
}
