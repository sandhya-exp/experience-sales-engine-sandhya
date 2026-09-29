import { query } from "@/lib/db";
import type { LeadStatus, Qualification } from "@/lib/types";
import { estimateDealValue } from "@/lib/dealSignals";
import type { DateFilter } from "@/lib/dashboard";
import { DOWNSTREAM } from "@/lib/modules";

/**
 * The Customer Sales Funnel — the analytical reading of the same records the
 * Pipeline works on. Pipeline asks "what do I work on?"; this asks "where do
 * customers drop out of the journey, and how long does each step take?"
 *
 * Nothing is stored. Every stage entry is a timestamp the workspace already
 * writes: the inquiry's `created_at`, `status_change` activities, the first
 * call or booked discovery call, the first quote. A lead counts at every
 * stage up to the furthest it reached, so the funnel is monotonic and
 * "drop-off" between two stages is a real number of customers.
 */
export type FunnelStage = "inquiry" | "contacted" | "discovery" | "qualified" | "quote_ready" | "won";

export const FUNNEL_STAGES: { key: FunnelStage; label: string; describe: string }[] = [
  { key: "inquiry", label: "Inquiry", describe: "Came in through Talk to Sales, the API or a rep" },
  { key: "contacted", label: "Contacted", describe: "First call, email or message went out" },
  { key: "discovery", label: "Discovery", describe: "A discovery call was booked or held" },
  { key: "qualified", label: "Qualified", describe: "Need, users, decision maker, timeline and budget confirmed" },
  { key: "quote_ready", label: "Quote Ready", describe: `Quoted, or marked ${DOWNSTREAM.name}` },
  { key: "won", label: "Won", describe: "Closed-won — hands off to contract, e-signature and onboarding" },
];
const RANK: Record<FunnelStage, number> = { inquiry: 0, contacted: 1, discovery: 2, qualified: 3, quote_ready: 4, won: 5 };
const STATUS_STAGE: Record<LeadStatus, FunnelStage | null> = { new: "inquiry", contacted: "contacted", qualified: "qualified", quoted: "quote_ready", won: "won", lost: null };

export interface FunnelFilters {
  date: DateFilter;
  ownerId: string | null; // "unassigned" allowed
  industry: string | null;
  source: string | null;
}

export interface FunnelLead {
  id: string;
  company_name: string;
  contact_name: string | null;
  industry: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  status: LeadStatus;
  created_at: string;
  source: string;
  /** Furthest stage reached. */
  furthest: FunnelStage;
  /** Stage the lead sits at now (furthest), or null when lost. */
  current: FunnelStage | null;
  lost: boolean;
  /** When the journey ended (won or lost), ms epoch; null while open. */
  endedAt: number | null;
  /** Entry time per stage reached, ms epoch. */
  entered: Partial<Record<FunnelStage, number>>;
  value: number;
  valueKind: "quoted" | "estimated" | null;
}

export interface FunnelStageStats {
  key: FunnelStage;
  label: string;
  describe: string;
  reached: number;
  /** Share of the previous stage that got here. Null on the first stage. */
  conversion: number | null;
  /** Share of all inquiries that got here. */
  ofInquiries: number;
  /** Reached the previous stage but not this one. */
  dropOff: number;
  /** Of the drop-off, how many are lost vs still open at the earlier stage. */
  dropLost: number;
  dropOpen: number;
  /** Open opportunities whose furthest stage is this one. */
  here: number;
  hereValue: number;
  hereQuoted: number;
  /** Lost with this as the furthest stage. */
  lostHere: number;
  /** Mean days from entering this stage to entering the next, over leads that moved on. */
  avgDays: number | null;
  /** Leads that moved on (the sample behind avgDays). */
  movedOn: number;
  /** Mean days spent so far by the leads sitting here now. */
  avgDaysHere: number | null;
}

export interface FunnelData {
  stages: FunnelStageStats[];
  leads: FunnelLead[];
  totalInquiries: number;
  totalWon: number;
  overallConversion: number | null;
  /** Inquiry → Won, mean days. */
  avgCycleDays: number | null;
  /** The stage with the largest drop-off, if any. */
  biggestDrop: { from: FunnelStage; to: FunnelStage; lost: number; share: number } | null;
  options: { owners: { id: string; name: string }[]; industries: string[]; sources: string[] };
  /** When this was computed, ms epoch — "time so far" is measured against it. */
  now: number;
}

type LeadRow = {
  id: string;
  company_name: string;
  contact_name: string | null;
  industry: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  status: LeadStatus;
  created_at: string;
  number_of_users: number | null;
  interest: string | null;
  qualification: Qualification | null;
  qualification_status: string;
};
type EventRow = { lead_id: string; kind: string; occurred_at: string; to_status: string | null; body: string | null; meta: Record<string, unknown> | null };

export async function loadFunnel(filters: FunnelFilters): Promise<FunnelData> {
  const [leads, events, quotes] = await Promise.all([
    query<LeadRow>(`
      select l.id, c.name as company_name, ct.name as contact_name, c.industry, l.owner_user_id, u.name as owner_name, l.status, l.created_at,
             l.number_of_users, l.interest, l.qualification, l.qualification_status
        from leads l
        join companies c on c.id = l.company_id
        left join contacts ct on ct.id = l.primary_contact_id
        left join app_users u on u.id = l.owner_user_id`),
    query<EventRow>(`
      select lead_id,
             case
               when type = 'status_change' then 'status'
               when type = 'call' and coalesce(metadata->>'kind','') <> 'follow_up' then 'call'
               when metadata->>'kind' = 'follow_up' then 'booking'
               when type in ('email','message') and coalesce(metadata->>'kind','') not in ('follow_up','agent_action') then 'touch'
               when metadata->>'kind' = 'quote' then 'quote'
               when metadata->>'kind' = 'lead_created' or body like 'Lead created from %' then 'created'
             end as kind,
             occurred_at, metadata->>'to' as to_status, body, metadata as meta
        from activities
       where type = 'status_change'
          or type in ('call','email','message')
          or metadata->>'kind' in ('follow_up','quote','lead_created')
          or body like 'Lead created from %'
       order by occurred_at asc`),
    query<{ lead_id: string; total: number; superseded: boolean }>(`
      select lead_id, (metadata->>'total')::numeric as total, coalesce((metadata->>'superseded')::boolean, false) as superseded
        from activities where metadata->>'kind' = 'quote' order by occurred_at desc`),
  ]);

  /* ---- per-lead events ---------------------------------------------------- */
  const byLead = new Map<string, EventRow[]>();
  for (const e of events) {
    if (!e.kind) continue;
    const list = byLead.get(e.lead_id) ?? [];
    list.push(e);
    byLead.set(e.lead_id, list);
  }
  const quoteValue = new Map<string, number>();
  for (const q of quotes) {
    if (q.superseded || quoteValue.has(q.lead_id)) continue;
    quoteValue.set(q.lead_id, Number(q.total) || 0);
  }

  const all: FunnelLead[] = leads.map((l) => {
    const evs = byLead.get(l.id) ?? [];
    const created = new Date(l.created_at).getTime();
    const t = (e: EventRow) => new Date(e.occurred_at).getTime();
    const firstStatus = (stages: LeadStatus[]) => {
      const hit = evs.find((e) => e.kind === "status" && stages.includes((e.to_status ?? legacyTo(e.body)) as LeadStatus));
      return hit ? t(hit) : null;
    };
    const firstOf = (kinds: string[]) => {
      const hit = evs.find((e) => kinds.includes(e.kind));
      return hit ? t(hit) : null;
    };
    const createdEv = evs.find((e) => e.kind === "created");
    const source = (createdEv?.meta?.heard_from as string) ?? (createdEv?.meta?.channel as string) ?? legacyChannel(createdEv?.body) ?? "Unknown";

    const statusRank = l.status === "lost" ? -1 : RANK[STATUS_STAGE[l.status] ?? "inquiry"];
    const entered: Partial<Record<FunnelStage, number>> = { inquiry: created };
    const contactedAt = firstStatus(["contacted", "qualified", "quoted", "won"]) ?? firstOf(["touch", "call", "booking"]);
    const discoveryAt = firstOf(["call", "booking"]);
    const qualifiedAt = firstStatus(["qualified", "quoted", "won"]) ?? (l.qualification_status === "qualified" ? firstStatus(["qualified"]) : null);
    const quoteAt = firstStatus(["quoted", "won"]) ?? firstOf(["quote"]);
    const wonAt = firstStatus(["won"]);
    const lostAt = firstStatus(["lost"]);

    // Furthest stage: the strongest evidence wins, and reaching a later stage implies the earlier ones.
    let furthestRank = Math.max(
      contactedAt !== null ? 1 : 0,
      discoveryAt !== null ? 2 : 0,
      qualifiedAt !== null || l.qualification_status === "qualified" ? 3 : 0,
      quoteAt !== null || quoteValue.has(l.id) ? 4 : 0,
      wonAt !== null ? 5 : 0
    );
    // A lost lead keeps the furthest stage it reached before losing; the status
    // rank only lifts open leads (a stage set by hand with no event behind it).
    if (l.status !== "lost") furthestRank = Math.max(furthestRank, statusRank);
    // Reached-by-implication stages get the best entry time we have.
    if (furthestRank >= 1) entered.contacted = contactedAt ?? created;
    if (furthestRank >= 2) entered.discovery = discoveryAt ?? qualifiedAt ?? entered.contacted ?? created;
    if (furthestRank >= 3) entered.qualified = qualifiedAt ?? entered.discovery ?? created;
    if (furthestRank >= 4) entered.quote_ready = quoteAt ?? entered.qualified ?? created;
    if (furthestRank >= 5) entered.won = wonAt ?? entered.quote_ready ?? created;
    // Keep entries monotonic: a stage cannot be entered before the one before it.
    let floor = created;
    for (const s of FUNNEL_STAGES.map((x) => x.key)) {
      if (entered[s] === undefined) continue;
      if ((entered[s] as number) < floor) entered[s] = floor;
      floor = entered[s] as number;
    }
    const furthest = FUNNEL_STAGES[furthestRank].key;
    const lost = l.status === "lost";
    const quoted = quoteValue.get(l.id);
    const est = quoted === undefined && !lost && l.status !== "won" ? estimateDealValue({ interest: l.interest, number_of_users: l.number_of_users, qualification: l.qualification ?? undefined }) : null;
    return {
      id: l.id,
      company_name: l.company_name,
      contact_name: l.contact_name,
      industry: l.industry,
      owner_user_id: l.owner_user_id,
      owner_name: l.owner_name,
      status: l.status,
      created_at: l.created_at,
      source,
      furthest,
      current: lost ? null : furthest,
      lost,
      endedAt: lost ? (lostAt ?? null) : wonAt ?? (l.status === "won" ? entered.won ?? null : null),
      entered,
      value: quoted ?? est?.amount ?? 0,
      valueKind: quoted !== undefined ? "quoted" : est ? "estimated" : null,
    };
  });

  /* ---- filters ------------------------------------------------------------- */
  const options = {
    owners: [...new Map(all.filter((l) => l.owner_user_id && l.owner_name).map((l) => [l.owner_user_id as string, { id: l.owner_user_id as string, name: l.owner_name as string }])).values()].sort((a, b) => a.name.localeCompare(b.name)),
    industries: [...new Set(all.map((l) => l.industry ?? "Unspecified"))].sort(),
    sources: [...new Set(all.map((l) => l.source))].sort(),
  };
  const { start, end } = window(filters.date);
  const filtered = all.filter((l) => {
    const c = new Date(l.created_at);
    if (start && c < start) return false;
    if (end && c >= end) return false;
    if (filters.ownerId === "unassigned" && l.owner_user_id) return false;
    if (filters.ownerId && filters.ownerId !== "unassigned" && l.owner_user_id !== filters.ownerId) return false;
    if (filters.industry && (l.industry ?? "Unspecified") !== filters.industry) return false;
    if (filters.source && l.source !== filters.source) return false;
    return true;
  });

  /* ---- stage stats --------------------------------------------------------- */
  const keys = FUNNEL_STAGES.map((s) => s.key);
  const reachedBy = (k: FunnelStage) => filtered.filter((l) => RANK[l.furthest] >= RANK[k]);
  const stages: FunnelStageStats[] = FUNNEL_STAGES.map((s, i) => {
    const reached = reachedBy(s.key);
    const prev = i > 0 ? reachedBy(keys[i - 1]) : null;
    const dropped = prev ? prev.filter((l) => RANK[l.furthest] < RANK[s.key]) : [];
    const here = filtered.filter((l) => l.current === s.key);
    const lostHere = filtered.filter((l) => l.lost && l.furthest === s.key);
    const next = keys[i + 1];
    const durations = next
      ? reached.filter((l) => l.entered[next] !== undefined && l.entered[s.key] !== undefined).map((l) => ((l.entered[next] as number) - (l.entered[s.key] as number)) / 86_400_000)
      : [];
    const now = Date.now();
    const hereDays = here.filter((l) => l.entered[s.key] !== undefined).map((l) => (now - (l.entered[s.key] as number)) / 86_400_000);
    return {
      key: s.key,
      label: s.label,
      describe: s.describe,
      reached: reached.length,
      conversion: prev ? (prev.length ? reached.length / prev.length : 0) : null,
      ofInquiries: filtered.length ? reached.length / filtered.length : 0,
      dropOff: dropped.length,
      dropLost: dropped.filter((l) => l.lost).length,
      dropOpen: dropped.filter((l) => !l.lost).length,
      here: here.length,
      hereValue: Math.round(here.reduce((n, l) => n + l.value, 0)),
      hereQuoted: here.filter((l) => l.valueKind === "quoted").length,
      lostHere: lostHere.length,
      avgDays: durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null,
      movedOn: durations.length,
      avgDaysHere: hereDays.length ? Math.round(hereDays.reduce((a, b) => a + b, 0) / hereDays.length) : null,
    };
  });

  const won = stages[stages.length - 1];
  const cycles = filtered.filter((l) => l.entered.won !== undefined).map((l) => ((l.entered.won as number) - (l.entered.inquiry as number)) / 86_400_000);
  let biggestDrop: FunnelData["biggestDrop"] = null;
  for (let i = 1; i < stages.length; i++) {
    const share = stages[i - 1].reached ? stages[i].dropOff / stages[i - 1].reached : 0;
    if (stages[i].dropOff > 0 && (!biggestDrop || share > biggestDrop.share)) biggestDrop = { from: keys[i - 1], to: keys[i], lost: stages[i].dropOff, share };
  }

  return {
    stages,
    leads: filtered,
    totalInquiries: filtered.length,
    totalWon: won.reached,
    overallConversion: filtered.length ? won.reached / filtered.length : null,
    avgCycleDays: cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null,
    biggestDrop,
    options,
    now: Date.now(),
  };
}

/* ------------------------------------------------------------------ helpers */

function legacyTo(body: string | null): string | null {
  const m = /to (\w+)\./.exec(body ?? "");
  return m ? m[1] : null;
}
function legacyChannel(body: string | null | undefined): string | null {
  const m = /^Lead created from (.+?)\.(\s|$)/.exec(body ?? "");
  return m ? m[1] : null;
}
function window(f: DateFilter): { start: Date | null; end: Date | null } {
  if (f.range === "all") return { start: null, end: null };
  if (f.range === "custom") {
    const end = f.to ? new Date(f.to + "T00:00:00") : null;
    if (end) end.setDate(end.getDate() + 1);
    return { start: f.from ? new Date(f.from + "T00:00:00") : null, end };
  }
  const start = new Date();
  if (f.range === "today") start.setHours(0, 0, 0, 0);
  else start.setDate(start.getDate() - (f.range === "7d" ? 7 : f.range === "30d" ? 30 : 90));
  return { start, end: null };
}
