import { query } from "@/lib/db";

/**
 * Customer history — what each account has bought, when, and for how much.
 *
 * Stored as activities (metadata.kind = "deal_history") on the won
 * opportunity that closed it, so there is no new table: a closed deal already
 * *is* an opportunity with a timeline, and this is one more event on it.
 *
 * ACV here is evidence about a customer, never a list price. Nothing in this
 * module is read by the pricing code; prices come only from `@/lib/catalog`.
 */
export const DEAL_HISTORY_KIND = "deal_history";

export type DealType = "new" | "expansion" | "renewal";

export interface DealHistoryMeta {
  kind: typeof DEAL_HISTORY_KIND;
  deal_type: DealType;
  products: { code: string; name: string; quantity?: number | null }[];
  /** Annual contract value of the deal, when recorded. */
  acv: number | null;
  /** Change in annual recurring revenue this deal made, for expansions. */
  arr_change: number | null;
  term_months: number | null;
  closed_at: string; // YYYY-MM-DD
  start_date: string | null;
  end_date: string | null;
  auto_renewal?: boolean;
  notes: string | null;
  /** Where this record came from — shown next to every fact the AI uses. */
  source: string;
  seed: boolean;
}

export interface DealHistoryRow extends DealHistoryMeta {
  activity_id: string;
  lead_id: string;
  company_id: string;
  company_name: string;
}

const SELECT = `select a.id as activity_id, a.lead_id, l.company_id, c.name as company_name, a.metadata
                  from activities a join leads l on l.id = a.lead_id join companies c on c.id = l.company_id
                 where a.metadata->>'kind' = '${DEAL_HISTORY_KIND}'`;

type RawRow = { activity_id: string; lead_id: string; company_id: string; company_name: string; metadata: DealHistoryMeta };

function toRow(r: RawRow): DealHistoryRow {
  return { ...r.metadata, activity_id: r.activity_id, lead_id: r.lead_id, company_id: r.company_id, company_name: r.company_name };
}

export async function dealHistoryForCompany(companyId: string): Promise<DealHistoryRow[]> {
  const rows = await query<RawRow>(`${SELECT} and l.company_id = $1 order by a.metadata->>'closed_at' asc`, [companyId]);
  return rows.map(toRow);
}

export async function recentDeals(opts: { type?: DealType; sinceDays?: number; limit?: number } = {}): Promise<DealHistoryRow[]> {
  const since = new Date(Date.now() - (opts.sinceDays ?? 365) * 86_400_000).toISOString().slice(0, 10);
  const params: unknown[] = [since, opts.limit ?? 10];
  const typeFilter = opts.type ? `and a.metadata->>'deal_type' = $3` : "";
  if (opts.type) params.push(opts.type);
  const rows = await query<RawRow>(`${SELECT} and a.metadata->>'closed_at' >= $1 ${typeFilter} order by a.metadata->>'closed_at' desc limit $2`, params);
  return rows.map(toRow);
}

/** The contract in force today, else the most recent one. */
export function currentContract(history: DealHistoryRow[], today = new Date().toISOString().slice(0, 10)): DealHistoryRow | null {
  const termed = history.filter((h) => h.end_date);
  const withTerm = termed.length ? termed : history;
  const live = withTerm.filter((h) => (h.start_date ?? h.closed_at) <= today && (!h.end_date || h.end_date >= today));
  const pick = (live.length ? live : withTerm).slice().sort((a, b) => b.closed_at.localeCompare(a.closed_at));
  return pick[0] ?? null;
}

export async function findCompanyByName(name: string): Promise<{ id: string; name: string; domain: string | null; industry: string | null } | null> {
  const rows = await query<{ id: string; name: string; domain: string | null; industry: string | null }>(
    `select id, name, domain, industry from companies where lower(name) = lower($1) or lower(name) like lower($2) order by (lower(name) = lower($1)) desc limit 1`,
    [name.trim(), `%${name.trim()}%`]
  );
  return rows[0] ?? null;
}
