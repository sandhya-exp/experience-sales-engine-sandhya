import { query } from "@/lib/db";

/**
 * What the team actually moved in a period — flow, not the pipeline snapshot.
 *
 * The stage strip answers "where does everything stand right now"; a lead that
 * arrived in July still sits in Contacted today. That is a different question
 * from "was this a good week", which needs counts of things that *happened*
 * between two dates.
 *
 * Every number is read from records that already exist: leads by created_at,
 * booked calls and stage changes from the activity timeline. Nothing is
 * stored for this, and deliberately nothing is money — no opportunity in this
 * workspace carries an amount, so a pipeline value here would be invented.
 */
export type ThroughputPeriod = "7d" | "30d" | "90d";

export const THROUGHPUT_PERIODS: { key: ThroughputPeriod; label: string; days: number }[] = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
];

export interface Throughput {
  /** Inquiries that arrived in the period. */
  inquiries: number;
  /** Discovery calls booked in the period (whenever the call itself falls). */
  callsBooked: number;
  /** Opportunities that reached Qualified in the period. */
  qualified: number;
  /** Opportunities handed across the contract boundary in the period. */
  handedOver: number;
  /** Opportunities marked Won in the period. */
  won: number;
}

export function periodStart(period: ThroughputPeriod): Date {
  const days = THROUGHPUT_PERIODS.find((p) => p.key === period)?.days ?? 7;
  return new Date(Date.now() - days * 86_400_000);
}

export async function throughputSince(from: Date): Promise<Throughput> {
  const [row] = await query<Record<string, string>>(
    `select
       (select count(*) from leads where created_at >= $1) as inquiries,
       (select count(*) from activities
          where metadata->>'kind' = 'follow_up' and occurred_at >= $1) as calls_booked,
       (select count(*) from activities
          where type = 'status_change' and occurred_at >= $1
            and coalesce(metadata->>'to', '') = 'qualified') as qualified_meta,
       (select count(*) from activities
          where type = 'status_change' and occurred_at >= $1
            and coalesce(metadata->>'to', '') = 'quoted') as handed_meta,
       (select count(*) from activities
          where type = 'status_change' and occurred_at >= $1
            and coalesce(metadata->>'to', '') = 'won') as won_meta,
       -- Stage changes recorded before the structured metadata existed still
       -- carry the sentence, so fall back to it rather than under-reporting.
       (select count(*) from activities
          where type = 'status_change' and occurred_at >= $1
            and metadata->>'to' is null and body like '%to qualified.') as qualified_legacy,
       (select count(*) from activities
          where type = 'status_change' and occurred_at >= $1
            and metadata->>'to' is null and body like '%to quoted.') as handed_legacy,
       (select count(*) from activities
          where type = 'status_change' and occurred_at >= $1
            and metadata->>'to' is null and body like '%to won.') as won_legacy`,
    [from.toISOString()]
  );
  const n = (v: string | undefined) => Number(v ?? 0);
  return {
    inquiries: n(row?.inquiries),
    callsBooked: n(row?.calls_booked),
    qualified: n(row?.qualified_meta) + n(row?.qualified_legacy),
    handedOver: n(row?.handed_meta) + n(row?.handed_legacy),
    won: n(row?.won_meta) + n(row?.won_legacy),
  };
}
