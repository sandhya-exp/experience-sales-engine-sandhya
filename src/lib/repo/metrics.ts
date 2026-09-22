import { query } from "@/lib/db";
import { effectiveStatus, type QuoteMeta } from "@/lib/repo/quotes";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/types";
import { trailingYear as trailingYearWindow, type MetricsWindow as Window } from "@/lib/reports/ranges";

/**
 * The numbers a sales manager asks for, read from rows the product already writes.
 *
 * Nothing here is stored or maintained. Revenue is the total on quotes the
 * customer accepted; pipeline value is the total on quotes still out with a
 * customer; a sales cycle is the gap between a lead's `created_at` and the
 * `status_change` that moved it to Won. If the team never quoted, every money
 * figure is honestly zero rather than estimated — this file does not model,
 * forecast or extrapolate anything.
 *
 * Three small reads, then arithmetic in one place. The volume is a few hundred
 * rows at demo scale, and keeping the maths here (rather than in SQL) is what
 * lets the funnel, the conversion rates and the month series all agree with
 * each other by construction.
 */

export interface MonthPoint {
  /** YYYY-MM */
  month: string;
  /** "Mar" — the axis label. */
  label: string;
  revenue: number;
  won: number;
}

export interface FunnelStep {
  stage: LeadStatus;
  label: string;
  /** Opportunities that reached this stage at any point. */
  reached: number;
  /** Share of the stage before it that got this far, 0–1. Null on the first step. */
  stepConversion: number | null;
  /** Share of all inquiries that got this far, 0–1. */
  cumulativeConversion: number;
}

export interface SalesMetrics {
  /** Oldest first, always twelve entries so the chart has a stable shape. */
  months: MonthPoint[];
  /** Accepted-quote value for deals won in the window. */
  revenueClosed: number;
  /** Value on quotes sent and still live on open opportunities, right now. */
  openPipelineValue: number;
  /** Mean accepted-quote value across wins in the window. */
  averageDealSize: number | null;
  /** Won ÷ (won + lost) in the window. */
  winRate: number | null;
  /** Accepted ÷ sent, across every quote that reached a customer in the window. */
  quoteConversion: number | null;
  /** Mean days from inquiry to Won, across wins in the window. */
  averageCycleDays: number | null;
  wonCount: number;
  lostCount: number;
  quotesSent: number;
  quotesAccepted: number;
  /** Open opportunities right now, whatever the window. */
  openCount: number;
  funnel: FunnelStep[];
  /** True when there is nothing to draw, so panels can say so instead of rendering an empty axis. */
  empty: boolean;
}

/** The funnel's forward path. Lost is an outcome, not a step, so it is not on it. */
const FUNNEL_PATH: LeadStatus[] = ["new", "contacted", "qualified", "quoted", "won"];

/** How far along the path each status sits, so "reached Qualified" includes everything past it. */
const RANK: Record<LeadStatus, number> = { new: 0, contacted: 1, qualified: 2, quoted: 3, won: 4, lost: -1 };

/* Periods live in a client-safe module so the range control and the generate
   dialog can import them without pulling the database driver into the browser.
   Re-exported here so every caller still has one place to look. */
export {
  METRIC_RANGES,
  isMetricRange,
  windowFor,
  trailingYear,
  describeWindow,
  type MetricRangeKey,
  type MetricsWindow,
} from "@/lib/reports/ranges";

export async function salesMetrics(window: Window = trailingYearWindow()): Promise<SalesMetrics> {
  const [leads, stageMoves, quoteRows] = await Promise.all([
    query<{ id: string; status: LeadStatus; created_at: unknown }>(`select id, status, created_at from leads`),
    query<{ lead_id: string; to_status: string | null; body: string; occurred_at: unknown }>(
      `select lead_id, metadata->>'to' as to_status, coalesce(body, '') as body, occurred_at
         from activities where type = 'status_change'`
    ),
    query<{ lead_id: string; metadata: unknown }>(`select lead_id, metadata from activities where metadata->>'kind' = 'quote'`),
  ]);

  const inWindow = (d: Date) => d >= window.from && d <= window.to;

  /* ---- stage history: when each lead first reached each stage ------------- */
  // Stage changes written before the structured metadata existed only carry the
  // sentence, so read that as a fallback rather than under-counting the past.
  const reachedAt = new Map<string, Partial<Record<LeadStatus, Date>>>();
  for (const move of stageMoves) {
    const to = (move.to_status ?? legacyTarget(move.body)) as LeadStatus | null;
    if (!to || !LEAD_STATUSES.includes(to)) continue;
    const when = asDate(move.occurred_at);
    const forLead = reachedAt.get(move.lead_id) ?? {};
    const existing = forLead[to];
    if (!existing || when < existing) forLead[to] = when;
    reachedAt.set(move.lead_id, forLead);
  }

  /* ---- quotes ------------------------------------------------------------ */
  const quotesByLead = new Map<string, QuoteMeta[]>();
  for (const row of quoteRows) {
    const meta = row.metadata as QuoteMeta | null;
    if (!meta || meta.kind !== "quote") continue;
    quotesByLead.set(row.lead_id, [...(quotesByLead.get(row.lead_id) ?? []), meta]);
  }
  /** The version that decided the outcome: the newest one that isn't superseded. */
  const decidingQuote = (leadId: string): QuoteMeta | null => {
    const all = quotesByLead.get(leadId) ?? [];
    const live = all.filter((q) => !q.superseded);
    return (live.length ? live : all).sort((a, b) => b.version - a.version)[0] ?? null;
  };

  /* ---- the twelve-month series ------------------------------------------- */
  const months: MonthPoint[] = [];
  const cursor = new Date(window.from);
  while (cursor <= window.to) {
    months.push({ month: monthKey(cursor), label: cursor.toLocaleString("en-US", { month: "short" }), revenue: 0, won: 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const monthIndex = new Map(months.map((m, i) => [m.month, i]));

  /* ---- walk the leads ----------------------------------------------------- */
  let revenueClosed = 0;
  let openPipelineValue = 0;
  let wonCount = 0;
  let lostCount = 0;
  let openCount = 0;
  let quotesSent = 0;
  let quotesAccepted = 0;
  const cycles: number[] = [];
  const dealSizes: number[] = [];
  const reachedCounts = new Map<LeadStatus, number>();
  let inquiriesInWindow = 0;

  for (const lead of leads) {
    const createdAt = asDate(lead.created_at);
    const history = reachedAt.get(lead.id) ?? {};
    const quote = decidingQuote(lead.id);
    const open = lead.status !== "won" && lead.status !== "lost";
    if (open) openCount += 1;

    // Funnel: a lead counts at every step at or below where it has been. Its
    // current status is the floor — a lead created straight into Contacted has
    // no status_change for it.
    const furthest = Math.max(RANK[lead.status], ...FUNNEL_PATH.map((s) => (history[s] ? RANK[s] : -1)));
    const enteredFunnel = inWindow(createdAt);
    if (enteredFunnel) {
      inquiriesInWindow += 1;
      for (const step of FUNNEL_PATH) {
        if (RANK[step] <= furthest) reachedCounts.set(step, (reachedCounts.get(step) ?? 0) + 1);
      }
    }

    // Quote conversion counts quotes that actually reached a customer.
    if (quote) {
      const status = effectiveStatus(quote);
      const everSent = quote.history.some((h) => h.status === "sent");
      if (everSent && inWindow(quoteSentAt(quote) ?? createdAt)) {
        quotesSent += 1;
        if (status === "accepted") quotesAccepted += 1;
      }
      // Live value: a quote in front of a customer on a deal that hasn't closed.
      if (open && (status === "sent" || status === "viewed" || status === "approved")) openPipelineValue += quote.total;
    }

    if (lead.status === "won") {
      const wonAt = history.won ?? createdAt;
      if (inWindow(wonAt)) {
        wonCount += 1;
        const value = quote?.total ?? 0;
        revenueClosed += value;
        if (value > 0) dealSizes.push(value);
        cycles.push(Math.max(0, Math.round((wonAt.getTime() - createdAt.getTime()) / 86_400_000)));
        const i = monthIndex.get(monthKey(wonAt));
        if (i !== undefined) {
          months[i].revenue += value;
          months[i].won += 1;
        }
      }
    } else if (lead.status === "lost") {
      const lostAt = history.lost ?? createdAt;
      if (inWindow(lostAt)) lostCount += 1;
    }
  }

  const funnel: FunnelStep[] = FUNNEL_PATH.map((stage, i) => {
    const reached = reachedCounts.get(stage) ?? 0;
    const previous = i === 0 ? null : reachedCounts.get(FUNNEL_PATH[i - 1]) ?? 0;
    return {
      stage,
      label: LEAD_STATUS_LABELS[stage],
      reached,
      stepConversion: previous === null ? null : previous > 0 ? reached / previous : 0,
      cumulativeConversion: inquiriesInWindow > 0 ? reached / inquiriesInWindow : 0,
    };
  });

  return {
    months,
    revenueClosed: round(revenueClosed),
    openPipelineValue: round(openPipelineValue),
    averageDealSize: dealSizes.length ? round(dealSizes.reduce((a, b) => a + b, 0) / dealSizes.length) : null,
    winRate: wonCount + lostCount > 0 ? wonCount / (wonCount + lostCount) : null,
    quoteConversion: quotesSent > 0 ? quotesAccepted / quotesSent : null,
    averageCycleDays: cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null,
    wonCount,
    lostCount,
    quotesSent,
    quotesAccepted,
    openCount,
    funnel,
    empty: wonCount === 0 && lostCount === 0 && quotesSent === 0,
  };
}

/* ------------------------------------------------------------------ helpers */

function quoteSentAt(q: QuoteMeta): Date | null {
  const entry = q.history.find((h) => h.status === "sent");
  return entry ? new Date(entry.at) : null;
}

function legacyTarget(body: string): string | null {
  const m = /to (\w+)\.$/.exec(body.trim());
  return m ? m[1] : null;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function asDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(String(v));
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

/** Compact money for a chart axis or a KPI tile: $128k, $1.4M. */
export function compactMoney(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function percent(v: number | null, digits = 0) {
  return v === null ? "—" : `${(v * 100).toFixed(digits)}%`;
}
