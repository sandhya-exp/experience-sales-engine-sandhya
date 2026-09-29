"use client";

import { useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { connectConnectorAction } from "@/app/actions/connectors";
import type { ConnectorInfo } from "@/lib/connectors/types";

/**
 * The small connect/setup dialog for a built-in connector: what it is for,
 * what the AI gains, the credentials it needs, one button. The vendor is
 * asked before anything is saved, so the "Connected" state that follows is
 * real — it names the mailbox, workspace or portal the vendor reported.
 */
export function ConnectDialog({ connector, open, onOpenChange, onConnected }: { connector: ConnectorInfo | null; open: boolean; onOpenChange: (o: boolean) => void; onConnected?: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const c = connector;
  const spec = c?.connect;
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setValues({});
      setError(null);
      setDone(null);
    }
  };

  return (
    <Dialog open={open && Boolean(c)} onOpenChange={close}>
      <DialogContent className="max-w-md">
        {c && (
          <>
            <DialogHeader>
              <DialogTitle>{done ? `${c.name} connected` : `Connect ${c.name}`}</DialogTitle>
              <DialogDescription className="mt-1">{spec?.intro ?? c.description}</DialogDescription>
            </DialogHeader>

            {done ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2.5 text-[13px]">
                  <span className="h-2 w-2 rounded-full bg-success" />
                  <span className="font-medium text-foreground">Connected</span>
                  <span className="text-muted-foreground">· {done}</span>
                </div>
                <p className="text-[12.5px] text-muted-foreground">{c.tools.map((t) => t.name.replace(/_/g, " ")).join(" · ")}</p>
                <div className="flex justify-end">
                  <Button onClick={() => close(false)}>Done</Button>
                </div>
              </div>
            ) : spec ? (
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Capabilities</p>
                  <ul className="mt-1.5 space-y-1">
                    {spec.capabilities.map((cap) => (
                      <li key={cap} className="flex items-center gap-2 text-[13px] text-foreground">
                        <Check className="h-3.5 w-3.5 text-success" /> {cap}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="space-y-2.5">
                  {spec.fields.map((f) => (
                    <div key={f.key} className="space-y-1">
                      <Label htmlFor={`cf-${f.key}`} className="text-[12.5px]">
                        {f.label}
                      </Label>
                      <Input id={`cf-${f.key}`} type={f.secret ? "password" : "text"} autoComplete="off" placeholder={f.placeholder} value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                    </div>
                  ))}
                </div>
                {spec.help && <p className="text-[12px] text-muted-foreground">{spec.help}</p>}
                {spec.docsUrl && (
                  <a href={spec.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
                    Vendor setup guide <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">{error}</p>}
                <Button
                  className="w-full"
                  disabled={busy || spec.fields.some((f) => !(values[f.key] ?? "").trim())}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    const r = await connectConnectorAction(c.key, values);
                    setBusy(false);
                    if (r.ok) {
                      setDone(r.account ?? "verified");
                      toast.success(r.detail);
                      onConnected?.();
                    } else setError(r.detail);
                  }}
                >
                  {busy ? `Checking with ${c.vendor}…` : `Connect ${c.name}`}
                </Button>
                <p className="text-center text-[11.5px] text-muted-foreground">Credentials are checked with {c.vendor} first and stored server-side only. The same values work as environment variables.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[13px] text-muted-foreground">{c.status.detail}</p>
                <p className="text-[12.5px] text-muted-foreground">This connector is configured through the deployment environment (Vercel → Settings → Environment Variables):</p>
                <ul className="space-y-1 font-mono text-[12px]">
                  {c.status.env.map((e) => (
                    <li key={e.key} className={e.present ? "text-foreground" : "text-muted-foreground"}>
                      {e.present ? "✓" : "○"} {e.key}
                    </li>
                  ))}
                </ul>
                <div className="flex justify-end">
                  <Button variant="outline" onClick={() => close(false)}>
                    Close
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
