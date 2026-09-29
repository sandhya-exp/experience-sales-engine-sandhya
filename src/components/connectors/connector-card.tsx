"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Building2, CalendarDays, Check, ChevronDown, Database, ExternalLink, Mail, MessageSquare, Plug, RefreshCw, Server, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConnectorInfo, ConnectorState, ToolKind } from "@/lib/connectors/types";
import { removeCustomServerAction, setConnectorEnabledAction, testCustomServerAction } from "@/app/actions/connectors";

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
export function ConnectorCard({ c }: { c: ConnectorInfo }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
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
        {/* The switch — on/off is the person's call; "connected" is the environment's. */}
        <button
          type="button"
          role="switch"
          aria-checked={c.enabled}
          aria-label={`${c.enabled ? "Switch off" : "Switch on"} ${c.name}`}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await setConnectorEnabledAction(c.key, !c.enabled);
              if (r.ok) toast.success(r.detail);
              else toast.error(r.detail);
            })
          }
          className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", c.enabled ? "bg-navy" : "bg-muted-foreground/30", pending && "opacity-60")}
        >
          <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", c.enabled ? "translate-x-5" : "translate-x-0.5")} />
        </button>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-label={open ? "Hide details" : "Show details"} className="text-muted-foreground hover:text-foreground">
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <div className="grid gap-4 border-t border-border px-4 py-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-3">
            <p className="text-[13px] text-muted-foreground">{c.description}</p>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tools exposed</p>
              <ul className="mt-1.5 divide-y divide-border rounded-lg border border-border">
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
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Used by</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {c.usedBy.map((u) => (
                  <li key={u} className="rounded-md bg-muted px-2 py-0.5 text-[12px] text-foreground">
                    {u}
                  </li>
                ))}
              </ul>
            </div>
            {c.custom ? (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Server</p>
                <p className="mt-1 break-all font-mono text-[12px] text-foreground">{c.url}</p>
                {c.status.checkedAt && <p className="text-[11.5px] text-muted-foreground">Last checked {new Date(c.status.checkedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>}
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await testCustomServerAction(c.key);
                        if (r.ok) toast.success(r.detail);
                        else toast.error(r.detail);
                      })
                    }
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Test connection
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await removeCustomServerAction(c.key);
                        if (r.ok) toast.success(r.detail);
                        else toast.error(r.detail);
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{configured ? "Configuration" : "To connect"}</p>
                <ul className="mt-1.5 space-y-1">
                  {c.status.env.map((e) => (
                    <li key={e.key} className="flex items-center gap-2 font-mono text-[12px]">
                      {e.present ? <Check className="h-3.5 w-3.5 text-success" /> : <X className="h-3.5 w-3.5 text-muted-foreground" />}
                      <span className={e.present ? "text-foreground" : "text-muted-foreground"}>{e.key}</span>
                    </li>
                  ))}
                </ul>
                {!configured && (
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    Set these in the environment (Vercel → Settings → Environment Variables) and redeploy. Nothing is simulated: until then this connector stays &ldquo;Not connected&rdquo; and its tools are not offered to the agent.
                  </p>
                )}
                {c.docsUrl && (
                  <a href={c.docsUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
                    <ExternalLink className="h-3 w-3" /> Vendor API docs
                  </a>
                )}
              </div>
            )}
            {c.key === "sales_engine" && (
              <p className="flex items-start gap-1.5 rounded-md bg-muted/50 px-2.5 py-2 text-[12px] text-muted-foreground">
                <Plug className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Any MCP client (Claude Desktop, Cursor, an agent) can connect to this app at <span className="font-mono">/api/mcp</span> with <span className="font-mono">Authorization: Bearer MCP_API_KEY</span>.
              </p>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
