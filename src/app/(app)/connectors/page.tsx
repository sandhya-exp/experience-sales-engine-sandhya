import { headers } from "next/headers";
import { Plug, Sparkles, Workflow } from "lucide-react";
import { listConnectors, workflowNodes } from "@/lib/connectors/registry";
import { settingsAvailable } from "@/lib/repo/settings";
import { ConnectorCard } from "@/components/connectors/connector-card";
import { AddServerDialog } from "@/components/connectors/add-server-dialog";
import { KpiTile } from "@/components/reports/charts";

/**
 * MCP Connectors — the external-system capabilities the AI and the Flow
 * Builder can use. Separate from the Pipeline (individual deals) and the
 * Funnel (customer conversion): this page is about what the system can reach.
 */
export const dynamic = "force-dynamic";

export default async function ConnectorsPage() {
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
  const [connectors, nodes, hasSettings] = await Promise.all([listConnectors(), workflowNodes(), settingsAvailable()]);
  const connected = connectors.filter((c) => c.status.state === "connected");
  const available = connectors.filter((c) => c.status.state !== "connected");
  const toolCount = connected.reduce((n, c) => n + c.tools.length, 0);
  const custom = connectors.filter((c) => c.custom);

  return (
    <div className="mx-auto max-w-6xl px-6 pb-12 pt-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-foreground">MCP Connectors</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">External systems the Sales Engine can reach, and the tools each exposes to the AI agent and to workflows. Connected means credentials are present; nothing here is simulated.</p>
        </div>
        <AddServerDialog selfUrl={`${origin}/api/mcp`} hasSettings={hasSettings} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiTile label="Connected" value={String(connected.length)} sub={`${available.length} more available`} tone="success" />
        <KpiTile label="Tools the agent can call" value={String(toolCount)} sub="Across connected, switched-on connectors" />
        <KpiTile label="Workflow nodes" value={String(nodes.length)} sub={`${nodes.filter((n) => n.requiresApproval).length} need a person's approval`} />
      </div>

      <section className="mt-6">
        <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Plug className="h-3.5 w-3.5" /> Connected
        </h2>
        <ul className="space-y-2">
          {connected.map((c) => (
            <ConnectorCard key={c.key} c={c} />
          ))}
          {connected.length === 0 && <li className="rounded-[var(--radius)] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">Nothing is connected yet.</li>}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Available</h2>
        <ul className="space-y-2">
          {available.map((c) => (
            <ConnectorCard key={c.key} c={c} />
          ))}
        </ul>
        {custom.length === 0 && (
          <p className="mt-2 text-[12.5px] text-muted-foreground">Any MCP server over HTTP can be added with the button above — it is probed with <span className="font-mono">initialize</span> and <span className="font-mono">tools/list</span> before it is saved.</p>
        )}
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[var(--radius)] border border-border bg-card p-4 card-shadow">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-navy" /> How the AI uses this
          </h3>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            When the agent decides an action it asks the registry what is reachable and records the answer on the action&rsquo;s trace (&ldquo;Connectors&rdquo; row). Tools marked <span className="font-medium text-foreground">needs approval</span> never run without a person; read and compute tools may run on their own. Switching a connector off here hides its tools from the agent immediately.
          </p>
        </div>
        <div className="rounded-[var(--radius)] border border-border bg-card p-4 card-shadow">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
            <Workflow className="h-4 w-4 text-navy" /> Flow Builder nodes
          </h3>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Every tool of a connected connector is available to the Experience Flow Builder as a node, for example <span className="font-mono text-[12px]">Trigger → get_customer → AI analysis → create_email_draft → create_calendar_event → create_task</span>. Right now that is {nodes.length} node{nodes.length === 1 ? "" : "s"}:
          </p>
          <p className="mt-2 font-mono text-[11.5px] leading-relaxed text-muted-foreground">{nodes.map((n) => n.id).join(" · ") || "—"}</p>
        </div>
      </section>
    </div>
  );
}
