"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink, Loader2, RefreshCcw, Terminal } from "lucide-react";
import { DOWNSTREAM } from "@/lib/modules";
import { MODULE_MOUNT, type QuoteModuleStatus } from "@/lib/quote-module";
import { cn } from "@/lib/utils";

/**
 * The right-hand workspace on the Quote Ready page: the quote module
 * (modules/guided-selling) embedded for the selected opportunity.
 *
 * The module is a separate process, so it can be absent for reasons the
 * workspace cannot fix on the user's behalf — most often it simply was not
 * started. When that happens this panel says so in as many words, shows the URL
 * it tried and the command that starts it, and offers a retry, because the
 * failure this replaces rendered one line of grey text in a very large empty
 * area and read as a blank page.
 *
 * A watchdog covers the case the server-side probe cannot see: the server
 * reaches the module but the browser does not (a deployed workspace still
 * pointing at 127.0.0.1, a blocked port). If the iframe has not fired `load`,
 * we re-ask the server and report whichever side is actually at fault.
 */
const LOAD_GRACE_MS = 6000;

export function QuoteModulePanel({ status, embedSrc }: { status: QuoteModuleStatus; embedSrc: string | null }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [serverSaysOk, setServerSaysOk] = useState<boolean | null>(null);
  const [retrying, setRetrying] = useState(false);
  const frame = useRef<HTMLIFrameElement | null>(null);

  const showFrame = status.state === "ok" && embedSrc;

  // The parent keys this component on embedSrc, so selecting another
  // opportunity remounts it and the load/stall state starts clean.
  useEffect(() => {
    if (!showFrame) return;
    const t = setTimeout(async () => {
      if (frame.current?.dataset.loaded === "1") return;
      setStalled(true);
      try {
        const res = await fetch("/api/quote-module/status", { cache: "no-store" });
        const s = (await res.json()) as QuoteModuleStatus;
        setServerSaysOk(s.state === "ok");
      } catch {
        setServerSaysOk(null);
      }
    }, LOAD_GRACE_MS);
    return () => clearTimeout(t);
  }, [showFrame]);

  const retry = () => {
    setRetrying(true);
    router.refresh();
    setTimeout(() => setRetrying(false), 1500);
  };

  if (!showFrame) {
    return <Diagnostic status={status} onRetry={retry} retrying={retrying} />;
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <iframe
        ref={frame}
        key={embedSrc}
        src={embedSrc}
        title={DOWNSTREAM.partner}
        onLoad={(e) => {
          (e.currentTarget as HTMLIFrameElement).dataset.loaded = "1";
          setLoaded(true);
          setStalled(false);
        }}
        className="h-full w-full flex-1 border-0 bg-background"
      />
      {!loaded && !stalled && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading {DOWNSTREAM.partner}…
          </p>
        </div>
      )}
      {stalled && !loaded && (
        <div className="absolute inset-0 overflow-y-auto bg-background">
          <Diagnostic
            status={status}
            onRetry={retry}
            retrying={retrying}
            stalledSrc={embedSrc}
            serverSaysOk={serverSaysOk}
          />
        </div>
      )}
    </div>
  );
}

function Diagnostic({
  status,
  onRetry,
  retrying,
  stalledSrc,
  serverSaysOk,
}: {
  status: QuoteModuleStatus;
  onRetry: () => void;
  retrying: boolean;
  stalledSrc?: string;
  serverSaysOk?: boolean | null;
}) {
  const notConfigured = status.state === "not_configured";
  // The iframe stalled even though the server can reach the module: the browser
  // is the one that cannot, so the start command is not the answer here.
  const browserSideOnly = Boolean(stalledSrc) && serverSaysOk === true;

  const title = notConfigured
    ? `${DOWNSTREAM.partner} is not configured on this environment`
    : browserSideOnly
      ? `Your browser could not load ${DOWNSTREAM.partner}`
      : `${DOWNSTREAM.partner} is not running`;

  const explanation = notConfigured
    ? "QUOTE_WORKSPACE_URL is not set, so the workspace does not know where the quote module is. It runs as its own service — this page embeds it, it does not host it."
    : browserSideOnly
      ? "This server reached the module, but the page in your browser could not load it from the address below. That usually means the embed URL points somewhere your browser cannot reach — a deployed workspace still pointing at a local address, or a blocked port."
      : "The quote module is a separate service (FastAPI, serving its own built React app). This server could not reach it, so there is nothing to embed. Nothing is wrong with this opportunity — the handoff is recorded and will load as soon as the module answers.";

  return (
    <div className="flex flex-1 items-start justify-center p-10">
      <div className="w-full max-w-xl rounded-[var(--radius)] border border-warning/40 bg-card card-shadow">
        <div className="flex items-start gap-3 border-b border-border bg-warning/5 px-5 py-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">{explanation}</p>
          </div>
        </div>

        <dl className="space-y-2.5 px-5 py-4 text-[13px]">
          {status.baseUrl && (
            <Row label="Module URL">
              <code className="font-mono text-[12px] text-foreground">{status.baseUrl}</code>
            </Row>
          )}
          {status.healthUrl && !browserSideOnly && (
            <Row label="Checked">
              <code className="font-mono text-[12px] text-foreground">{status.healthUrl}</code>
              {status.detail && <span className="ml-2 text-muted-foreground">— {status.detail}</span>}
            </Row>
          )}
          {stalledSrc && (
            <Row label="Embed URL">
              <code className="break-all font-mono text-[12px] text-foreground">{stalledSrc}</code>
            </Row>
          )}
          {notConfigured && (
            <Row label="Set">
              <code className="font-mono text-[12px] text-foreground">QUOTE_WORKSPACE_URL=http://127.0.0.1:8001</code>
              <span className="ml-2 text-muted-foreground">in .env.local, then restart the workspace</span>
            </Row>
          )}
        </dl>

        {!notConfigured && !browserSideOnly && (
          <div className="border-t border-border px-5 py-4">
            <p className="section-label flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" /> Start it
            </p>
            <p className="mt-2 text-[13px] text-muted-foreground">
              From the repository root, this starts the workspace and the module together:
            </p>
            <pre className="mt-1.5 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-[12px] text-foreground">
              {status.startCommand}
            </pre>
            <p className="mt-2.5 text-[13px] text-muted-foreground">Or start just the module, in its own terminal:</p>
            <pre className="mt-1.5 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-[12px] text-foreground">
              cd modules/guided-selling{"\n"}.venv/bin/uvicorn app.main:app --port 8001
            </pre>
            <p className="mt-2 text-[12px] text-muted-foreground">
              First time on this machine, the module needs its dependencies:{" "}
              <code className="font-mono">python3 -m venv .venv &amp;&amp; .venv/bin/pip install -r requirements.txt</code>
            </p>
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1.5 rounded-md bg-navy px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-navy-light disabled:opacity-60"
          >
            <RefreshCcw className={cn("h-3.5 w-3.5", retrying && "animate-spin")} />
            {retrying ? "Checking…" : "Check again"}
          </button>
          {status.baseUrl && (
            <a
              href={MODULE_MOUNT}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
            >
              Open the module directly <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="section-label shrink-0 sm:w-24">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
