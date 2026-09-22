import { salesMetrics, windowFor, describeWindow, isMetricRange, compactMoney, percent, type MetricRangeKey } from "@/lib/repo/metrics";
import { listLeadRows } from "@/lib/repo/leads";
import { listOpenQuotes, formatMoney } from "@/lib/repo/quotes";
import { requireUser } from "@/lib/authz";
import { canViewTeamReports } from "@/lib/roles";
import { PrintTrigger } from "@/components/reports/print-trigger";
import { StageFunnel } from "@/components/reports/charts";

/**
 * The generated sales report — one page, built to be printed.
 *
 * Deliberately not a PDF generated on the server. A PDF library is a real
 * dependency (and a heavyweight one on a serverless host) to produce something
 * every browser already makes better: this page opens the print dialog, and
 * "Save as PDF" gives a proper, selectable, one-page document with the right
 * paper size and the user's own margins. No new package, nothing to keep up to
 * date, and it prints identically from any device.
 *
 * Every figure is the same reading of the same rows the Reports dashboard uses,
 * so a printed report can never disagree with the screen it came from.
 */
export default async function ReportPrintPage({ searchParams }: PageProps<"/reports/print">) {
  const params = await searchParams;
  const range: MetricRangeKey = isMetricRange(params.range) ? params.range : "12m";
  const from = typeof params.from === "string" ? params.from : null;
  const to = typeof params.to === "string" ? params.to : null;
  // A manager can ask for their own book instead of the team's.
  const mineOnly = params.scope === "mine";
  const window_ = windowFor(range, new Date(), { from, to });

  // Outside the app shell on purpose — a printed report should be the report,
  // not a screenshot of the application around it. That means guarding it here
  // rather than relying on the workspace layout.
  const user = await requireUser();
  const [rows, quotes] = await Promise.all([listLeadRows(), listOpenQuotes()]);
  const teamWide = canViewTeamReports(user.role) && !mineOnly;
  const scoped = teamWide ? rows : rows.filter((r) => r.owner_user_id === user.id);
  const m = await salesMetrics(window_);

  // The deals that actually closed in the window, for the table under the numbers.
  const valueByLead = new Map<string, number>();
  for (const q of quotes) if (!q.meta.superseded && !valueByLead.has(q.leadId)) valueByLead.set(q.leadId, q.meta.total);
  const closed = scoped
    .filter((r) => (r.status === "won" || r.status === "lost") && new Date(r.updated_at) >= window_.from)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 14);

  return (
    <div className="mx-auto max-w-[820px] bg-white px-10 py-8 text-[#172246] print:px-0 print:py-0">
      <PrintTrigger />

      <header className="flex items-start justify-between border-b-2 border-[#172246] pb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#64708a]">Experience.com · Sales Engine</p>
          <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-tight">Sales report</h1>
          <p className="mt-0.5 text-[13px] text-[#64708a]">
            {describeWindow(window_)} · {teamWide ? "whole team" : `${user.name}’s pipeline`}
          </p>
        </div>
        <div className="text-right text-[12px] text-[#64708a]">
          <p>Generated {new Date().toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}</p>
          <p>{user.name}</p>
        </div>
      </header>

      <section className="mt-6 grid grid-cols-3 gap-x-8 gap-y-5">
        {[
          { label: "Revenue closed", value: compactMoney(m.revenueClosed), sub: `${m.wonCount} deal${m.wonCount === 1 ? "" : "s"} won` },
          { label: "Open pipeline", value: compactMoney(m.openPipelineValue), sub: "Quotes live with a customer" },
          { label: "Average deal", value: m.averageDealSize === null ? "—" : compactMoney(m.averageDealSize), sub: "Mean accepted quote" },
          { label: "Win rate", value: percent(m.winRate), sub: `${m.wonCount} won · ${m.lostCount} lost` },
          { label: "Quote conversion", value: percent(m.quoteConversion), sub: `${m.quotesAccepted} of ${m.quotesSent} accepted` },
          { label: "Sales cycle", value: m.averageCycleDays === null ? "—" : `${m.averageCycleDays} days`, sub: "Inquiry to won, on average" },
        ].map((k) => (
          <div key={k.label}>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[#64708a]">{k.label}</p>
            <p className="mt-1 text-[22px] font-bold leading-none tabular-nums">{k.value}</p>
            <p className="mt-1 text-[11px] text-[#64708a]">{k.sub}</p>
          </div>
        ))}
      </section>

      <section className="mt-7">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#64708a]">Stage progression</h2>
        <div className="mt-2.5">
          <StageFunnel steps={m.funnel} />
        </div>
      </section>

      <section className="mt-7">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#64708a]">Revenue by month</h2>
        <table className="mt-2 w-full text-[12px]">
          <tbody>
            <tr className="border-b border-[#e3e8f2]">
              {m.months.map((mo) => (
                <td key={mo.month} className="py-1 text-center font-medium">
                  {mo.label}
                </td>
              ))}
            </tr>
            <tr className="border-b border-[#e3e8f2]">
              {m.months.map((mo) => (
                <td key={mo.month} className="py-1.5 text-center tabular-nums">
                  {mo.revenue > 0 ? compactMoney(mo.revenue) : "—"}
                </td>
              ))}
            </tr>
            <tr>
              {m.months.map((mo) => (
                <td key={mo.month} className="py-1 text-center text-[11px] tabular-nums text-[#64708a]">
                  {mo.won || "—"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <p className="mt-1 text-[10.5px] text-[#64708a]">Closed-won value, then how many deals closed that month.</p>
      </section>

      {closed.length > 0 && (
        <section className="mt-7">
          <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#64708a]">Deals closed in this period</h2>
          <table className="mt-2 w-full text-[12px]">
            <thead>
              <tr className="border-b border-[#172246] text-left text-[10.5px] uppercase tracking-wide text-[#64708a]">
                <th className="pb-1 font-semibold">Company</th>
                <th className="pb-1 font-semibold">Owner</th>
                <th className="pb-1 font-semibold">Outcome</th>
                <th className="pb-1 text-right font-semibold">Value</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((r) => (
                <tr key={r.id} className="border-b border-[#eef1f6]">
                  <td className="py-1.5 font-medium">{r.company_name}</td>
                  <td className="py-1.5 text-[#64708a]">{r.owner_name ?? "Unassigned"}</td>
                  <td className="py-1.5">{r.status === "won" ? "Won" : "Lost"}</td>
                  <td className="py-1.5 text-right tabular-nums">{valueByLead.get(r.id) ? formatMoney(valueByLead.get(r.id)!) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <footer className="mt-8 border-t border-[#e3e8f2] pt-3 text-[10.5px] text-[#64708a]">
        Figures are read from the opportunities, quotes and stage history in Sales Engine at the time of generation. Revenue is the total on accepted quotes;
        nothing is forecast or estimated.
      </footer>
    </div>
  );
}
