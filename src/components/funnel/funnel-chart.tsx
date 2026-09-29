import Link from "next/link";
import { ArrowDown, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { compactMoney, percent } from "@/lib/repo/metrics";
import type { FunnelStage, FunnelStageStats } from "@/lib/repo/funnel";

/**
 * The funnel itself: one band per stage, narrowing with the customers who
 * got there, with the conversion, drop-off and time between bands written on
 * the connector — the three things a manager asks about each step. Every
 * band is a link: the number opens the customers behind it.
 */
export function FunnelChart({ stages, selected, href }: { stages: FunnelStageStats[]; selected: FunnelStage | null; href: (stage: FunnelStage) => string }) {
  const widest = Math.max(...stages.map((s) => s.reached), 1);
  return (
    <ol className="space-y-0">
      {stages.map((s, i) => {
        const width = Math.max((s.reached / widest) * 100, s.reached > 0 ? 18 : 8);
        const active = selected === s.key;
        return (
          <li key={s.key}>
            {i > 0 && (
              <div className="flex items-center gap-2 py-1 pl-1 text-[12px] text-muted-foreground">
                <ArrowDown className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium text-foreground tabular-nums">{s.conversion === null ? "—" : percent(s.conversion)}</span>
                <span>converted</span>
                {s.dropOff > 0 ? (
                  <span>
                    · <span className="font-medium text-destructive tabular-nums">{s.dropOff}</span> dropped off
                    <span className="text-muted-foreground/80">
                      {" "}
                      ({s.dropLost} lost{s.dropOpen ? `, ${s.dropOpen} still open` : ""})
                    </span>
                  </span>
                ) : (
                  <span>· no drop-off</span>
                )}
                {stages[i - 1].avgDays !== null && (
                  <span className="inline-flex items-center gap-1">
                    · <Clock className="h-3 w-3" /> {stages[i - 1].avgDays}d in {stages[i - 1].label.toLowerCase()} on average
                  </span>
                )}
              </div>
            )}
            <Link
              href={href(s.key)}
              scroll={false}
              className={cn(
                "group grid grid-cols-[1fr_auto] items-center gap-4 rounded-lg border px-3 py-2.5 transition-colors sm:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_auto]",
                active ? "border-navy/40 bg-[#eef2fb]" : "border-transparent hover:border-border hover:bg-muted/30"
              )}
              aria-current={active ? "true" : undefined}
            >
              <div className="min-w-0">
                <p className="flex items-baseline gap-2">
                  <span className="text-[14px] font-semibold text-foreground">{s.label}</span>
                  <span className="text-[12px] text-muted-foreground">{percent(s.ofInquiries)} of inquiries</span>
                </p>
                <p className="truncate text-[12px] text-muted-foreground">{s.describe}</p>
              </div>
              <div className="hidden sm:block">
                <div className="mx-auto h-9 overflow-hidden rounded-md bg-muted" style={{ width: `${width}%` }}>
                  <div
                    className="flex h-full items-center justify-center rounded-md text-[12px] font-semibold text-white"
                    style={{ background: `color-mix(in srgb, var(--primary) ${45 + i * 11}%, white)` }}
                  >
                    {s.reached}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[20px] font-semibold tabular-nums leading-none text-foreground">{s.reached}</p>
                <p className="mt-1 text-[11.5px] text-muted-foreground">
                  {s.key === "won" ? (
                    <>{s.hereValue > 0 ? `${compactMoney(s.hereValue)} closed` : "closed-won"}</>
                  ) : (
                    <>
                      <span className="tabular-nums text-foreground">{s.here}</span> here now
                      {s.hereValue > 0 && (
                        <>
                          {" "}
                          · <span className="tabular-nums text-foreground">{compactMoney(s.hereValue)}</span>
                          {s.hereQuoted < s.here ? " est." : ""}
                        </>
                      )}
                      {s.lostHere > 0 && <> · {s.lostHere} lost</>}
                    </>
                  )}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
