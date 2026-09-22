import Link from "next/link";
import { cn } from "@/lib/utils";
import { THROUGHPUT_PERIODS, type Throughput, type ThroughputPeriod } from "@/lib/repo/throughput";

/**
 * What moved in the period, beside the pipeline's "where things stand".
 *
 * The stage strip is a snapshot: an opportunity that arrived in July still
 * sits in Contacted today, so those numbers never answer "was this a good
 * week". These five do, and they are counts of things that happened —
 * inquiries received, calls booked, opportunities qualified, handed to
 * contract, won — each read from records that already exist.
 *
 * Deliberately no money. Nothing in this workspace carries a deal amount, so
 * a "pipeline value" here would be a number we made up.
 */
export function ThroughputStrip({ throughput, period }: { throughput: Throughput; period: ThroughputPeriod }) {
  const items = [
    { label: "Inquiries", value: throughput.inquiries, href: "/pipeline?stage=new" },
    { label: "Calls booked", value: throughput.callsBooked, href: "/schedule" },
    { label: "Qualified", value: throughput.qualified, href: "/pipeline?stage=qualified" },
    { label: "Handed to contract", value: throughput.handedOver, href: "/pipeline?stage=quoted" },
    { label: "Won", value: throughput.won, href: "/pipeline?stage=won" },
  ];
  return (
    <section className="mt-4">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="section-label">Activity</p>
        <div className="flex items-center gap-1">
          {THROUGHPUT_PERIODS.map((p) => (
            <Link
              key={p.key}
              href={p.key === "7d" ? "/" : `/?period=${p.key}`}
              aria-pressed={period === p.key}
              className={cn(
                "rounded-md px-2 py-1 text-[12px] font-medium transition-colors",
                period === p.key ? "bg-navy text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>
      <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius)] border border-border bg-border sm:grid-cols-5">
        {items.map((i) => (
          <li key={i.label} className="bg-card">
            <Link href={i.href} className="flex h-full flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/60">
              <span className="section-label">{i.label}</span>
              <span className={cn("text-xl font-semibold leading-none tabular-nums", i.value === 0 ? "text-muted-foreground" : "text-foreground")}>
                {i.value}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
