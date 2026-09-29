import Link from "next/link";
import { cn } from "@/lib/utils";
import { percent } from "@/lib/repo/metrics";
import type { FunnelStage, FunnelStageStats } from "@/lib/repo/funnel";
import { DOWNSTREAM } from "@/lib/modules";

/**
 * The customer journey as a funnel. One band per stage, narrowing with the
 * customers who got there, and for each stage the three things a manager
 * asks about the *population* — how many moved forward, how many dropped,
 * how long it took — never what is sitting there now (that is the
 * Pipeline's job). Every band is a link: the number opens the customers
 * behind it.
 */
export function FunnelChart({ stages, selected, href }: { stages: FunnelStageStats[]; selected: FunnelStage | null; href: (stage: FunnelStage) => string }) {
  const widest = Math.max(...stages.map((s) => s.reached), 1);
  return (
    <ol className="space-y-1.5">
      {stages.map((s, i) => {
        const next = stages[i + 1] ?? null;
        const width = Math.max((s.reached / widest) * 100, s.reached > 0 ? 18 : 8);
        const active = selected === s.key;
        return (
          <li key={s.key}>
            <Link
              href={href(s.key)}
              scroll={false}
              className={cn(
                "group grid grid-cols-[auto_1fr] items-center gap-4 rounded-lg border px-3 py-2.5 transition-colors sm:grid-cols-[72px_minmax(0,1.2fr)_minmax(0,1.6fr)]",
                active ? "border-navy/40 bg-[#eef2fb]" : "border-transparent hover:border-border hover:bg-muted/30"
              )}
              aria-current={active ? "true" : undefined}
            >
              <p className="text-[24px] font-semibold tabular-nums leading-none text-foreground">{s.reached}</p>
              <div className="min-w-0">
                <p className="flex items-baseline gap-2">
                  <span className="text-[14px] font-semibold text-foreground">{s.label}</span>
                  {i > 0 && <span className="text-[11.5px] text-muted-foreground">{percent(s.ofInquiries)} of inquiries</span>}
                </p>
                <p className="text-[12.5px] text-muted-foreground">
                  {next ? (
                    <>
                      <span className="font-medium text-foreground tabular-nums">{s.reached ? percent(next.reached / s.reached) : "—"}</span> moved forward
                      {" · "}
                      <span className={cn("font-medium tabular-nums", next.dropOff > 0 ? "text-destructive" : "text-foreground")}>{next.dropOff}</span> dropped
                      {s.avgDays !== null && (
                        <>
                          {" · "}
                          <span className="font-medium text-foreground tabular-nums">{s.avgDays}d</span> avg
                        </>
                      )}
                    </>
                  ) : (
                    <>Closed-won · continues to contract, e-signature and onboarding in {DOWNSTREAM.partner}</>
                  )}
                </p>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <div className="mx-auto h-8 overflow-hidden rounded-md bg-muted" style={{ width: `${width}%` }}>
                  <div className="h-full rounded-md" style={{ background: `color-mix(in srgb, var(--primary) ${45 + i * 11}%, white)` }} />
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
