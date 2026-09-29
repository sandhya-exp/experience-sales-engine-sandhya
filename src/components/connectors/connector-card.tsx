"use client";

import { useState, useTransition } from "react";
import { ConnectDialog } from "@/components/connectors/connect-dialog";
import { toast } from "sonner";
import { Building2, CalendarDays, Check, ChevronDown, Database, ExternalLink, Mail, MessageSquare, Plug, RefreshCw, Server, Trash2, Unplug, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConnectorInfo, ConnectorState, ToolKind } from "@/lib/connectors/types";
import { disconnectConnectorAction, removeCustomServerAction, setConnectorEnabledAction, testCustomServerAction, verifyConnectorAction, type ConnectorActionResult } from "@/app/actions/connectors";

const ICON: Record<ConnectorInfo["category"], React.ComponentType<{ className?: string }>> = {
  internal: Database,
  email: Mail,
  calendar: CalendarDays,
  messaging: MessageSquare,
  crm: Building2,
  custom: Server,
};

const STATE: Record<ConnectorState, { label: string; variant: "success" | "outline" | "warning" | "destructive" | "secondary" }> = {
  connected: { label: "Connected", variant: "success" },
  not_connected: { label: "Not connected", variant: "outline" },
  demo: { label: "Demo connector", variant: "warning" },
  error: { label: "Error", variant: "destructive" },
  disabled: { label: "Off", variant: "secondary" },
};

const KIND: Record<ToolKind, { label: string; variant: "outline" | "navy" | "warning" | "destructive" }> = {
  read: { label: "read", variant: "outline" },
  compute: { label: "compute", variant: "outline" },
  draft: { label: "draft", variant: "navy" },
  request: { label: "needs approval", variant: "warning" },
  write: { label: "write", variant: "destructive" },
};

/** One connector, in the style of a connector-manager row: identity, status, a switch, and details on demand. */
export function ConnectorCard({ c, onChanged, selfUrl }: { c: ConnectorInfo; onChanged?: () => void; selfUrl?: string }) {
  const [open, setOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ConnectorActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.detail);
        onChanged?.();
      } else toast.error(r.detail);
    });
  const Icon = ICON[c.category];
  const st = STATE[c.status.state];
  const configured = c.status.state === "connected" || c.status.state === "demo" || c.status.state === "disabled";

  return (
    <li className="rounded-[var(--radius)] border border-border bg-card card-shadow">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", c.status.state === "connected" ? "bg-navy text-white" : "bg-muted text-muted-foreground")}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-foreground">{c.name}</span>
            <span className="text-[12px] text-muted-foreground">{c.vendor}</span>
            <Badge variant={st.variant} className="font-medium">
              {st.label}
            </Badge>
            <span className="text-[12px] text-muted-foreground">
              · {c.tools.length} tool{c.tools.length === 1 ? "" : "s"}
            </span>
          </p>
          <p className="truncate text-[12.5px] text-muted-foreground">{c.status.detail}</p>
        </button>
        {/* Configured connectors get an on/off switch; unconfigured ones get a Connect button (or nothing when only the environment can configure them). */}
        {configured ? (
          <button
            type="button"
            role="switch"
            aria-checked={c.enabled}
            aria-label={`${c.enabled ? "Switch off" : "Switch on"} ${c.name}`}
            disabled={pending}
            onClick={() => run(() => setConnectorEnabledAction(c.key, !c.enabled))}
            className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", c.enabled ? "bg-navy" : "bg-muted-foreground/30", pending && "opacity-60")}
          >
            <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", c.enabled ? "translate-x-5" : "translate-x-0.5")} />
          </button>
        ) : c.connect ? (
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setConnectOpen(true)}>
            <Plug className="h-3.5 w-3.5" /> Connect
          </Button>
        ) : c.custom ? (
          <Button size="sm" variant="outline" className="shrink-0" disabled={pending} onClick={() => run(() => testCustomServerAction(c.key))}>
            <RefreshCw className="h-3.5 w-3.5" /> Test
          </Button>
        ) : null}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-label={open ? "Hide details" : "Show details"} className="text-muted-foreground hover:text-foreground">
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <div className="grid gap-5 border-t border-border px-4 py-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4">
            <p className="text-[13px] text-muted-foreground">{c.description}</p>

            <Section title="Tools & permissions">
              <ul className="divide-y divide-border rounded-lg border border-border">
                {c.tools.map((t) => (
                  <li key={t.name} className="flex items-start justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block font-mono text-[12.5px] text-foreground">{t.name}</span>
                      <span className="block text-[12px] text-muted-foreground">{t.description}</span>
                      {t.inputs.length > 0 && <span className="block text-[11px] text-muted-foreground/80">inputs: {t.inputs.join(", ")}</span>}
                    </span>
                    <Badge variant={KIND[t.kind].variant} className="shrink-0 font-medium">
                      {KIND[t.kind].label}
                    </Badge>
                  </li>
                ))}
                {c.tools.length === 0 && <li className="px-3 py-3 text-[12.5px] text-muted-foreground">No tools discovered yet — test the connection.</li>}
              </ul>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">read and compute tools may run on their own; draft tools produce something a person reviews; needs approval and write tools never run without a person.</p>
            </Section>

            <Section title="Used by">
              <ul className="flex flex-wrap gap-1.5">
                {c.usedBy.map((u) => (
                  <li key={u} className="rounded-md bg-muted px-2 py-0.5 text-[12px] text-foreground">
                    {u}
                  </li>
                ))}
              </ul>
            </Section>
          </div>

          <div className="space-y-4">
            <Section title="Authentication">
              {c.custom ? (
                <p className="text-[12.5px] text-muted-foreground">{c.url && /^https?:\/\//.test(c.url) ? "Bearer token" : "None"} — set when the server was added; never sent to the browser.</p>
              ) : c.connection?.source === "saved" ? (
                <div className="space-y-2">
                  <p className="text-[12.5px] text-foreground">
                    Connected from the app{c.connection.account ? ` as ${c.connection.account}` : ""}
                    {c.connection.verifiedAt && <span className="text-muted-foreground"> · verified {fmt(c.connection.verifiedAt)}</span>}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => verifyConnectorAction(c.key))}>
                      <RefreshCw className="h-3.5 w-3.5" /> Verify again
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => run(() => disconnectConnectorAction(c.key))}>
                      <Unplug className="h-3.5 w-3.5" /> Disconnect
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <ul className="space-y-1">
                    {c.status.env.map((e) => (
                      <li key={e.key} className="flex items-center gap-2 font-mono text-[12px]">
                        {e.present ? <Check className="h-3.5 w-3.5 text-success" /> : <X className="h-3.5 w-3.5 text-muted-foreground" />}
                        <span className={e.present ? "text-foreground" : "text-muted-foreground"}>{e.key}</span>
                      </li>
                    ))}
                  </ul>
                  {configured ? (
                    <p className="text-[12px] text-muted-foreground">Configured through the deployment environment. To disconnect, remove the variables in Vercel and redeploy.</p>
                  ) : c.connect ? (
                    <Button size="sm" onClick={() => setConnectOpen(true)}>
                      <Plug className="h-3.5 w-3.5" /> Connect {c.name}
                    </Button>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">Set these in the environment (Vercel → Settings → Environment Variables) and redeploy. Until then this connector stays &ldquo;Not connected&rdquo; and its tools are not offered to the agent.</p>
                  )}
                  {c.docsUrl && (
                    <a href={c.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
                      <ExternalLink className="h-3 w-3" /> Vendor API docs
                    </a>
                  )}
                </div>
              )}
            </Section>

            <Section title="MCP server URL">
              {c.custom ? (
                <p className="break-all font-mono text-[12px] text-foreground">{c.url}</p>
              ) : c.key === "sales_engine" ? (
                <p className="text-[12px] text-muted-foreground">
                  <span className="font-mono text-foreground">{selfUrl ?? "/api/mcp"}</span> — any MCP client (Claude Desktop, Cursor, an agent) can connect with <span className="font-mono">Authorization: Bearer MCP_API_KEY</span>.
                </p>
              ) : (
                <p className="text-[12px] text-muted-foreground">Built-in adapter — the Sales Engine calls {c.vendor}&rsquo;s API directly and exposes it as MCP tools; there is no separate server to point at.</p>
              )}
            </Section>

            <Section title="Connection health">
              <p className="flex items-start gap-2 text-[12.5px]">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", c.status.state === "connected" ? "bg-success" : c.status.state === "error" ? "bg-destructive" : "bg-muted-foreground/40")} />
                <span className="text-foreground">{c.status.detail}</span>
              </p>
              {c.status.checkedAt && <p className="mt-1 text-[11.5px] text-muted-foreground">Last checked {fmt(c.status.checkedAt)}</p>}
              {c.custom && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => testCustomServerAction(c.key))}>
                    <RefreshCw className="h-3.5 w-3.5" /> Test connection
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => run(() => removeCustomServerAction(c.key))}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete server
                  </Button>
                </div>
              )}
            </Section>
          </div>
        </div>
      )}
      <ConnectDialog connector={c} open={connectOpen} onOpenChange={setConnectOpen} onConnected={onChanged} />
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
