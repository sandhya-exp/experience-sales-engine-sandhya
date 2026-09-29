import { headers } from "next/headers";
import { Link2, Plug, Sparkles, Workflow } from "lucide-react";
import { listConnectors, workflowNodes } from "@/lib/connectors/registry";
import { settingsAvailable } from "@/lib/repo/settings";
import { ConnectorCard } from "@/components/connectors/connector-card";
import { AddServerDialog } from "@/components/connectors/add-server-dialog";
import { KpiTile } from "@/components/reports/charts";

/**
 * Manage connectors — the MCP configuration surface. The plug menu in the
 * top bar is the quick switcher (status, connect, on/off); this page holds
 * everything deeper: authentication, server URL, tools and permissions,
 * connection health, which AI workflows use each connector, disconnect and
 * delete. Separate from the Pipeline (deals) and the Funnel (conversion).
 */
export const dynamic = "force-dynamic";

export default async function ConnectorsPage() {
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
  const selfUrl = `${origin}/api/mcp`;
  const [connectors, nodes, hasSettings] = await Promise.all([listConnectors(), workflowNodes(), settingsAvailable()]);
  const connected = connectors.filter((c) => c.status.state === "connected");
  const available = connectors.filter((c) => c.status.state !== "connected");
  const native = connectors.filter((c) => c.layer === "native");
  const ownMcp = connectors.filter((c) => c.layer === "mcp" && c.key === "sales_engine");
  const externalMcp = connectors.filter((c) => c.layer === "mcp" && c.key !== "sales_engine");
  const toolCount = connected.reduce((n, c) => n + c.tools.length, 0);
  const custom = connectors.filter((c) => c.custom);

  return (
    <div className="mx-auto max-w-6xl px-6 pb-12 pt-8">
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-foreground">Integrations &amp; MCP</h1>
          <AddServerDialog selfUrl={selfUrl} hasSettings={hasSettings} />
        </div>
        <p className="mt-1 max-w-4xl text-[15px] text-muted-foreground">Application integrations are services the Sales Engine calls directly (send an email, book a discovery call). MCP connections are standardized tool servers the AI Sales Agent works through: this application&rsquo;s own Sales Engine MCP, plus external and custom servers. For each: authentication, server URL, tools and permissions, connection health, and which AI workflows use it. Connected means the vendor confirmed the credentials; nothing here is simulated.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiTile label="Connected" value={String(connected.length)} sub={`${available.length} more available`} tone="success" />
        <KpiTile label="Tools the agent can call" value={String(toolCount)} sub="Across connected, switched-on connectors" />
        <KpiTile label="Workflow nodes" value={String(nodes.length)} sub={`${nodes.filter((n) => n.requiresApproval).length} need a person's approval`} />
      </div>

      <section className="mt-6">
        <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" /> Application integrations
        </h2>
        <ul className="space-y-2">
          {native.map((c) => (
            <ConnectorCard key={c.key} c={c} selfUrl={selfUrl} />
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Plug className="h-3.5 w-3.5" /> MCP servers
        </h2>
        <ul className="space-y-2">
          {ownMcp.map((c) => (
            <ConnectorCard key={c.key} c={c} selfUrl={selfUrl} />
          ))}
        </ul>
        <h3 className="mb-2 mt-4 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">External MCP servers</h3>
        <ul className="space-y-2">
          {externalMcp.map((c) => (
            <ConnectorCard key={c.key} c={c} selfUrl={selfUrl} />
          ))}
        </ul>
        {custom.length === 0 && (
          <p className="mt-2 text-[12.5px] text-muted-foreground">Any MCP server over HTTP can be added with the + button — it is probed with <span className="font-mono">initialize</span> and <span className="font-mono">tools/list</span> before it is saved.</p>
        )}
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[var(--radius)] border border-border bg-card p-4 card-shadow">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-navy" /> How the AI uses this
          </h3>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            When the agent decides an action it asks the registry what is reachable and records the answer on the action&rsquo;s trace (&ldquo;Connectors&rdquo; row). Tools marked <span className="font-medium text-foreground">needs approval</span> never run without a person; read and compute tools may run on their own. Switching a connector off hides its tools from the agent immediately.
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
