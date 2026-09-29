"use client";

import { useCallback, useState, useTransition } from "react";
import { Building2, CalendarDays, Database, Mail, MessageSquare, Plug, Plus, Server, SlidersHorizontal, Sparkles, Workflow } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConnectorCard } from "@/components/connectors/connector-card";
import { AddServerDialog } from "@/components/connectors/add-server-dialog";
import { loadConnectorsAction, setConnectorEnabledAction, type ConnectorsSnapshot } from "@/app/actions/connectors";
import type { ConnectorInfo } from "@/lib/connectors/types";
import { cn } from "@/lib/utils";

const ICON: Record<ConnectorInfo["category"], React.ComponentType<{ className?: string }>> = {
  internal: Database,
  email: Mail,
  calendar: CalendarDays,
  messaging: MessageSquare,
  crm: Building2,
  custom: Server,
};

/**
 * MCP Connectors from the top bar, as a menu rather than a page: two
 * actions on top (add a server, manage in detail), then every connector
 * with its on/off switch. Loaded when opened so it is always current.
 */
export function ConnectorsMenu() {
  const [snap, setSnap] = useState<ConnectorsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSnap(await loadConnectorsAction());
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <>
      <DropdownMenu
        onOpenChange={(o) => {
          if (o) void load();
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="MCP Connectors"
            aria-label="MCP Connectors"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 data-[state=open]:bg-muted data-[state=open]:text-foreground"
          >
            <Plug className="h-[18px] w-[18px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[320px] p-1.5">
          <DropdownMenuItem onSelect={() => setAddOpen(true)} className="gap-2.5 px-2.5 py-2 text-[13.5px]">
            <Plus className="h-4 w-4 text-muted-foreground" /> Add custom MCP server
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setManageOpen(true)} className="gap-2.5 px-2.5 py-2 text-[13.5px]">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" /> Manage connectors
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {!snap && (
            <div className="space-y-1.5 p-1.5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-8 animate-pulse rounded-md bg-muted/60" />
              ))}
            </div>
          )}
          {snap && (
            <ul className={cn("max-h-[60vh] overflow-y-auto", loading && "opacity-60")}>
              {snap.connectors.map((c) => (
                <ConnectorRow key={c.key} c={c} onChanged={load} />
              ))}
            </ul>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {snap && <AddServerDialog selfUrl={snap.selfUrl} hasSettings={snap.hasSettings} onChanged={load} open={addOpen} onOpenChange={setAddOpen} showTrigger={false} />}

      <ConnectorsDetailDialog open={manageOpen} onOpenChange={setManageOpen} snap={snap} loading={loading} onChanged={load} onAdd={() => setAddOpen(true)} />
    </>
  );
}

function ConnectorRow({ c, onChanged }: { c: ConnectorInfo; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const Icon = ICON[c.category];
  const configured = c.status.state === "connected" || c.status.state === "demo" || c.status.state === "disabled";
  const on = configured && c.enabled;

  return (
    <li className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-muted/60" title={configured ? undefined : c.status.detail}>
      <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", on ? "bg-navy text-white" : "bg-muted text-muted-foreground")}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[13.5px]", configured ? "text-foreground" : "text-muted-foreground")}>{c.name}</span>
        {!configured && <span className="block truncate text-[11px] text-muted-foreground">Not connected</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${on ? "Switch off" : "Switch on"} ${c.name}`}
        disabled={pending || !configured}
        onClick={() =>
          start(async () => {
            const r = await setConnectorEnabledAction(c.key, !c.enabled);
            if (r.ok) {
              toast.success(r.detail);
              onChanged();
            } else toast.error(r.detail);
          })
        }
        className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed", on ? "bg-navy" : "bg-muted-foreground/30", (pending || !configured) && "opacity-50")}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-[18px]" : "translate-x-0.5")} />
      </button>
    </li>
  );
}

/** The full view — tools per connector, what uses them, custom-server test/remove — as a dialog. */
function ConnectorsDetailDialog({
  open,
  onOpenChange,
  snap,
  loading,
  onChanged,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  snap: ConnectorsSnapshot | null;
  loading: boolean;
  onChanged: () => void;
  onAdd: () => void;
}) {
  const connected = snap?.connectors.filter((c) => c.status.state === "connected") ?? [];
  const available = snap?.connectors.filter((c) => c.status.state !== "connected") ?? [];
  const toolCount = connected.reduce((n, c) => n + c.tools.length, 0);
  const nodes = snap?.nodes ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4 pr-8">
            <div>
              <DialogTitle>MCP Connectors</DialogTitle>
              <DialogDescription className="mt-1">External systems the Sales Engine can reach and the tools each exposes to the AI agent and to workflows. Connected means credentials are present; nothing here is simulated.</DialogDescription>
            </div>
            <button type="button" onClick={onAdd} title="Add custom MCP server" aria-label="Add custom MCP server" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy text-white transition-opacity hover:opacity-90">
              <Plus className="h-[18px] w-[18px]" />
            </button>
          </div>
        </DialogHeader>

        {snap && (
          <div className={cn("space-y-5", loading && "opacity-60")}>
            <div className="grid gap-2 sm:grid-cols-3">
              <Tile label="Connected" value={connected.length} sub={`${available.length} more available`} tone="text-success" />
              <Tile label="Tools the agent can call" value={toolCount} sub="Across switched-on connectors" />
              <Tile label="Workflow nodes" value={nodes.length} sub={`${nodes.filter((n) => n.requiresApproval).length} need a person's approval`} />
            </div>

            <section>
              <h3 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Plug className="h-3.5 w-3.5" /> Connected
              </h3>
              <ul className="space-y-2">
                {connected.map((c) => (
                  <ConnectorCard key={c.key} c={c} onChanged={onChanged} />
                ))}
                {connected.length === 0 && <li className="rounded-[var(--radius)] border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">Nothing is connected yet.</li>}
              </ul>
            </section>

            <section>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Available</h3>
              <ul className="space-y-2">
                {available.map((c) => (
                  <ConnectorCard key={c.key} c={c} onChanged={onChanged} />
                ))}
              </ul>
              {!snap.connectors.some((c) => c.custom) && (
                <p className="mt-2 text-[12.5px] text-muted-foreground">
                  Any MCP server over HTTP can be added with the + button — it is probed with <span className="font-mono">initialize</span> and <span className="font-mono">tools/list</span> before it is saved.
                </p>
              )}
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[var(--radius)] border border-border bg-muted/30 p-3.5">
                <h4 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                  <Sparkles className="h-4 w-4 text-navy" /> How the AI uses this
                </h4>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  When the agent decides an action it asks the registry what is reachable and records the answer on the action&rsquo;s trace. Tools marked <span className="font-medium text-foreground">needs approval</span> never run without a person. Switching a connector off hides its tools from the agent immediately.
                </p>
              </div>
              <div className="rounded-[var(--radius)] border border-border bg-muted/30 p-3.5">
                <h4 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                  <Workflow className="h-4 w-4 text-navy" /> Flow Builder nodes
                </h4>
                <p className="mt-1 text-[12.5px] text-muted-foreground">Every tool of a connected connector is a node in the Experience Flow Builder — {nodes.length} right now.</p>
                <p className="mt-1.5 line-clamp-3 font-mono text-[11px] leading-relaxed text-muted-foreground">{nodes.map((n) => n.id).join(" · ") || "—"}</p>
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card px-3.5 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-[22px] font-bold leading-none tabular-nums text-foreground", tone)}>{value}</p>
      <p className="mt-1 text-[12px] text-muted-foreground">{sub}</p>
    </div>
  );
}
