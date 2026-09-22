/**
 * Reporting periods — client-safe.
 *
 * Deliberately its own module with no server imports. The range control and the
 * generate dialog are client components, and pulling these constants out of the
 * metrics layer would drag the database driver into the browser bundle with
 * them. The metrics layer re-exports everything here, so there is still one
 * definition of what "last 6 months" means.
 */
export const METRIC_RANGES = [
  { key: "12m", label: "Last 12 months", months: 12 },
  { key: "6m", label: "Last 6 months", months: 6 },
  { key: "3m", label: "Last 3 months", months: 3 },
  { key: "ytd", label: "This year", months: 0 },
] as const;

export type MetricRangeKey = (typeof METRIC_RANGES)[number]["key"];

export function isMetricRange(v: unknown): v is MetricRangeKey {
  return METRIC_RANGES.some((r) => r.key === v);
}

export interface MetricsWindow {
  from: Date;
  to: Date;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The period every figure on a report is measured over.
 *
 * A preset is the common case, but a manager asking "how did Q2 go" needs to
 * say so exactly — so an explicit from/to wins over the preset when both are
 * present, and a half-open range (a start with no end) is read as "since then".
 */
export function windowFor(key: MetricRangeKey, now = new Date(), custom?: { from?: string | null; to?: string | null }): MetricsWindow {
  const explicitFrom = custom?.from && ISO_DAY.test(custom.from) ? new Date(`${custom.from}T00:00:00`) : null;
  const explicitTo = custom?.to && ISO_DAY.test(custom.to) ? new Date(`${custom.to}T23:59:59`) : null;
  if (explicitFrom || explicitTo) {
    return { from: explicitFrom ?? new Date(0), to: explicitTo ?? new Date(now) };
  }

  const to = new Date(now);
  const from = new Date(now);
  if (key === "ytd") {
    from.setMonth(0, 1);
    from.setHours(0, 0, 0, 0);
    return { from, to };
  }
  const months = METRIC_RANGES.find((r) => r.key === key)?.months || 12;
  from.setMonth(from.getMonth() - (months - 1));
  from.setDate(1);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

/** The last twelve whole months up to today — the default every page uses. */
export function trailingYear(now = new Date()): MetricsWindow {
  return windowFor("12m", now);
}

/** "1 Jan – 22 Sep 2026" — the period, as a person would write it. */
export function describeWindow(w: MetricsWindow): string {
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${w.from.getTime() === 0 ? "Everything" : fmt(w.from)} – ${fmt(w.to)}`;
}
