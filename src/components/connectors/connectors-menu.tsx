"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { Building2, CalendarDays, Database, Mail, MessageSquare, Plug, Plus, Server, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AddServerDialog } from "@/components/connectors/add-server-dialog";
import { ConnectDialog } from "@/components/connectors/connect-dialog";
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
 * The plug menu in the top bar: the quick switcher. Two shelves — the
 * application's native integrations, and the MCP servers whose tools the
 * AI agent calls — with status at a glance, connect in place, on/off.
 * Everything deeper — authentication, server URL, tools and permissions,
 * health, which workflows use it, disconnect/delete — lives on Manage
 * connectors (/connectors).
 */
export function ConnectorsMenu() {
  const [snap, setSnap] = useState<ConnectorsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [connectKey, setConnectKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSnap(await loadConnectorsAction());
    } finally {
      setLoading(false);
    }
  }, []);

  const isConnected = (c: ConnectorInfo) => c.status.state === "connected" || c.status.state === "disabled" || c.status.state === "demo";
  const native = snap?.connectors.filter((c) => c.layer === "native") ?? [];
  const ownMcp = snap?.connectors.filter((c) => c.layer === "mcp" && c.key === "sales_engine") ?? [];
  const externalMcp = snap?.connectors.filter((c) => c.layer === "mcp" && c.key !== "sales_engine") ?? [];
  const connectTarget = snap?.connectors.find((c) => c.key === connectKey) ?? null;

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
            title="Integrations & MCP"
            aria-label="Integrations & MCP"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 data-[state=open]:bg-muted data-[state=open]:text-foreground"
          >
            <Plug className="h-[18px] w-[18px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[340px] p-1.5">
          {!snap && (
            <div className="space-y-1.5 p-1.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-8 animate-pulse rounded-md bg-muted/60" />
              ))}
            </div>
          )}
          {snap && (
            <div className={cn("max-h-[70vh] overflow-y-auto", loading && "opacity-60")}>
              <DropdownMenuLabel className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Application integrations</DropdownMenuLabel>
              <ul>
                {native.map((c) => (isConnected(c) ? <ConnectedRow key={c.key} c={c} onChanged={load} /> : <NotConnectedRow key={c.key} c={c} onPick={() => setConnectKey(c.key)} />))}
              </ul>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Plug className="h-3.5 w-3.5" /> MCP servers
              </DropdownMenuLabel>
              <ul>
                {ownMcp.map((c) => (isConnected(c) ? <ConnectedRow key={c.key} c={c} onChanged={load} /> : <NotConnectedRow key={c.key} c={c} onPick={() => setConnectKey(c.key)} />))}
              </ul>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">External MCP servers</DropdownMenuLabel>
              <ul>
                {externalMcp.map((c) => (isConnected(c) ? <ConnectedRow key={c.key} c={c} onChanged={load} /> : <NotConnectedRow key={c.key} c={c} onPick={() => setConnectKey(c.key)} />))}
              </ul>
              <DropdownMenuItem onSelect={() => setAddOpen(true)} className="gap-2.5 px-2.5 py-2 text-[13.5px]">
                <Plus className="h-4 w-4 text-muted-foreground" /> Add custom MCP server
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="gap-2.5 px-2.5 py-2 text-[13.5px]">
                <Link href="/connectors">
                  <SlidersHorizontal className="h-4 w-4 text-muted-foreground" /> Manage connections
                </Link>
              </DropdownMenuItem>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {snap && <AddServerDialog selfUrl={snap.selfUrl} hasSettings={snap.hasSettings} onChanged={load} open={addOpen} onOpenChange={setAddOpen} showTrigger={false} />}
      <ConnectDialog connector={connectTarget} open={connectKey !== null} onOpenChange={(o) => !o && setConnectKey(null)} onConnected={load} />
    </>
  );
}

function Row({ c, on, right, onClick, sub }: { c: ConnectorInfo; on: boolean; right: React.ReactNode; onClick?: () => void; sub?: string }) {
  const Icon = ICON[c.category];
  const inner = (
    <>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", on ? "bg-success" : "border border-muted-foreground/50")} aria-hidden />
      <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", on ? "bg-navy text-white" : "bg-muted text-muted-foreground")}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[13.5px]", on ? "text-foreground" : "text-muted-foreground")}>{c.name}</span>
        {sub && <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>}
      </span>
      {right}
    </>
  );
  return onClick ? (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-muted/60">
        {inner}
      </button>
    </li>
  ) : (
    <li className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-muted/60">{inner}</li>
  );
}

function ConnectedRow({ c, onChanged }: { c: ConnectorInfo; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const on = c.enabled;
  const label = c.status.state === "demo" ? "Demo" : on ? "Connected" : "Off";
  return (
    <Row
      c={c}
      on={on}
      sub={c.connection?.account ? `as ${c.connection.account}` : undefined}
      right={
        <>
          <span className={cn("text-[12px]", on && c.status.state !== "demo" ? "text-success" : "text-muted-foreground")}>{label}</span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={`${on ? "Switch off" : "Switch on"} ${c.name}`}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await setConnectorEnabledAction(c.key, !c.enabled);
                if (r.ok) {
                  toast.success(r.detail);
                  onChanged();
                } else toast.error(r.detail);
              })
            }
            className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-navy" : "bg-muted-foreground/30", pending && "opacity-50")}
          >
            <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-[18px]" : "translate-x-0.5")} />
          </button>
        </>
      }
    />
  );
}

function NotConnectedRow({ c, onPick }: { c: ConnectorInfo; onPick: () => void }) {
  return <Row c={c} on={false} onClick={onPick} right={<span className="text-[12px] text-muted-foreground">{c.status.state === "error" ? "Error" : "Not connected"}</span>} />;
}
