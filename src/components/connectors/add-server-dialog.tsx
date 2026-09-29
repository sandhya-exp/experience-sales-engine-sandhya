"use client";

import { useState } from "react";
import { Plus, Server } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { addCustomServerAction, probeServerAction } from "@/app/actions/connectors";

/**
 * Add a custom MCP server: name, URL, optional bearer token. "Test" performs
 * a real initialize + tools/list; "Add" saves only a server that answered.
 * The app's own /api/mcp is offered as a one-click example, which doubles as
 * proof that the client and server speak the same protocol.
 */
export function AddServerDialog({ selfUrl, hasSettings }: { selfUrl: string; hasSettings: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<{ ok: boolean; detail: string; tools: { name: string; description: string }[] } | null>(null);

  const reset = () => {
    setName("");
    setUrl("");
    setToken("");
    setProbe(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="navy" size="icon" className="h-10 w-10 shrink-0 rounded-full" title="Add custom MCP server" aria-label="Add custom MCP server">
          <Plus className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-4 w-4 text-navy" /> Add a custom MCP server
          </DialogTitle>
        </DialogHeader>
        {!hasSettings && <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] text-foreground">Saving needs the <span className="font-mono">app_settings</span> table — run <span className="font-mono">npm run db:schema</span> against the database first. Testing works without it.</p>}
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="mcp-name">Name</Label>
            <Input id="mcp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pricing service" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mcp-url">Server URL (HTTP / Streamable HTTP)</Label>
            <Input id="mcp-url" value={url} onChange={(e) => { setUrl(e.target.value); setProbe(null); }} placeholder="https://example.com/mcp" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mcp-token">Bearer token (optional)</Label>
            <Input id="mcp-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Sent as Authorization: Bearer …" autoComplete="off" />
          </div>
          <button
            type="button"
            className="text-[12px] font-medium text-primary hover:underline"
            onClick={() => {
              setName("Sales Engine (this app)");
              setUrl(selfUrl);
              setProbe(null);
            }}
          >
            Use this app&rsquo;s own MCP endpoint as an example
          </button>
          {probe && (
            <div className={`rounded-md border px-3 py-2 text-[12.5px] ${probe.ok ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"}`}>
              <p className="font-medium text-foreground">{probe.ok ? "Server answered" : "No MCP server there"}</p>
              <p className="text-muted-foreground">{probe.detail}</p>
              {probe.ok && probe.tools.length > 0 && <p className="mt-1 font-mono text-[11.5px] text-muted-foreground">{probe.tools.slice(0, 8).map((t) => t.name).join(" · ")}{probe.tools.length > 8 ? ` · +${probe.tools.length - 8} more` : ""}</p>}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy || !url.trim()}
              onClick={async () => {
                setBusy(true);
                setProbe(await probeServerAction(url, token || null));
                setBusy(false);
              }}
            >
              {busy ? "Testing…" : "Test connection"}
            </Button>
            <Button
              disabled={busy || !url.trim() || !name.trim() || !hasSettings}
              onClick={async () => {
                setBusy(true);
                const r = await addCustomServerAction({ name, url, bearerToken: token || null });
                setBusy(false);
                if (r.ok) {
                  toast.success(r.detail);
                  setOpen(false);
                  reset();
                } else toast.error(r.detail);
              }}
            >
              Add server
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
