"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarPlus, Loader2, Video } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createScheduleAction } from "@/app/actions/schedule";
import { MEETING_DURATIONS, type MeetingDuration } from "@/lib/calendar/recommend";
import { CONFERENCING, type ConferenceKey } from "@/lib/calendar/conferencing";
import { cn } from "@/lib/utils";

export interface SchedulableLead {
  id: string;
  companyName: string;
  contactName: string | null;
  ownerName: string | null;
  /** True when a meeting is already booked — shown, but not selectable. */
  alreadyBooked: boolean;
}

interface RepAvailability {
  timeZone: string;
  owner: { id: string; name: string } | null;
  slots: { start: string; end: string }[];
  provider: { kind: "google" | "local"; label: string };
}

/**
 * Book a meeting from the sales side.
 *
 * Pick the opportunity first, because everything else depends on it: the times
 * offered are the ones its *owner* is free, inside office hours, not the times
 * anyone on the team happens to have. Choosing a different opportunity re-asks
 * the server rather than filtering a list in the browser, so what you see is
 * always current free/busy.
 */
export function NewScheduleDialog({ leads }: { leads: SchedulableLead[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [leadId, setLeadId] = useState("");
  const [minutes, setMinutes] = useState<MeetingDuration>(30);
  const [conference, setConference] = useState<ConferenceKey>("meet");
  const [slot, setSlot] = useState("");
  const [data, setData] = useState<RepAvailability | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const key = leadId ? `${leadId}:${minutes}` : null;
  const loading = Boolean(key) && loadedKey !== key;

  useEffect(() => {
    if (!open || !leadId) return;
    let cancelled = false;
    fetch(`/api/availability/rep?lead=${leadId}&minutes=${minutes}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: RepAvailability) => {
        if (cancelled) return;
        setData(d);
        setSlot("");
        setLoadedKey(`${leadId}:${minutes}`);
      })
      .catch(() => {
        if (cancelled) return;
        setData(null);
        setLoadedKey(`${leadId}:${minutes}`);
      });
    return () => {
      cancelled = true;
    };
  }, [open, leadId, minutes]);

  const days = useMemo(() => {
    if (!data) return [];
    const tz = data.timeZone;
    const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
    const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
    const map = new Map<string, { label: string; slots: { start: string; time: string }[] }>();
    for (const s of data.slots) {
      const d = new Date(s.start);
      const label = dayFmt.format(d);
      if (!map.has(label)) map.set(label, { label, slots: [] });
      map.get(label)!.slots.push({ start: s.start, time: timeFmt.format(d) });
    }
    return [...map.values()].slice(0, 5);
  }, [data]);

  const selected = leads.find((l) => l.id === leadId) ?? null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <CalendarPlus className="h-3.5 w-3.5" /> Create new schedule
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule a meeting</DialogTitle>
        </DialogHeader>

        <form
          action={(fd) =>
            start(async () => {
              const r = await createScheduleAction(fd);
              if (r.ok) {
                toast.success(r.detail);
                setOpen(false);
                setLeadId("");
                setSlot("");
              } else toast.error(r.detail);
            })
          }
          className="space-y-4"
        >
          <input type="hidden" name="minutes" value={minutes} />
          <input type="hidden" name="slot" value={slot} />

          <div className="space-y-1.5">
            <Label htmlFor="sch-lead">Opportunity</Label>
            <select
              id="sch-lead"
              name="leadId"
              required
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-card px-2.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Choose an opportunity…</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id} disabled={l.alreadyBooked}>
                  {l.companyName}
                  {l.contactName ? ` · ${l.contactName}` : ""}
                  {l.ownerName ? ` · ${l.ownerName}` : " · unassigned"}
                  {l.alreadyBooked ? " — already booked" : ""}
                </option>
              ))}
            </select>
            {selected?.ownerName && (
              <p className="text-[12px] text-muted-foreground">Times below are when {selected.ownerName} is free, within office hours.</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sch-title">What is it</Label>
              <Input id="sch-title" name="title" defaultValue="Discovery call" />
            </div>
            <div className="space-y-1.5">
              <Label>Length</Label>
              <div className="inline-flex rounded-lg border border-input bg-card p-0.5">
                {MEETING_DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={minutes === d}
                    onClick={() => setMinutes(d)}
                    className={cn("rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors", minutes === d ? "bg-navy text-white" : "text-muted-foreground hover:bg-muted")}
                  >
                    {d === 60 ? "1 hour" : `${d} min`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Video className="h-3.5 w-3.5" /> How you&rsquo;ll meet
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {CONFERENCING.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={conference === c.key}
                  title={c.hint}
                  onClick={() => setConference(c.key)}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                    conference === c.key ? "border-navy bg-navy text-white" : "border-border bg-card text-foreground hover:border-navy/40"
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <input type="hidden" name="conference" value={conference} />
            <p className="text-[12px] text-muted-foreground">{CONFERENCING.find((c) => c.key === conference)?.hint}</p>
            {(conference === "zoom" || conference === "teams") && (
              <Input name="conferenceUrl" type="url" placeholder={conference === "zoom" ? "https://zoom.us/j/…" : "https://teams.microsoft.com/l/meetup-join/…"} required />
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Pick a time</Label>
            {!leadId && <p className="rounded-md bg-muted px-3 py-2 text-[13px] text-muted-foreground">Choose an opportunity first.</p>}
            {leadId && loading && (
              <p className="flex items-center gap-2 py-2 text-[13px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Checking the calendar…
              </p>
            )}
            {leadId && !loading && days.length === 0 && (
              <p className="rounded-md bg-warning/10 px-3 py-2 text-[13px] text-warning">
                No free {minutes}-minute slots in office hours over the next few days. Try a shorter meeting.
              </p>
            )}
            {leadId && !loading && days.length > 0 && (
              <div className="space-y-2.5">
                {days.map((d) => (
                  <div key={d.label}>
                    <p className="mb-1 text-[12px] font-medium text-foreground">{d.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {d.slots.map((s) => (
                        <button
                          key={s.start}
                          type="button"
                          aria-pressed={slot === s.start}
                          onClick={() => setSlot(s.start)}
                          className={cn(
                            "rounded-md border px-2.5 py-1 text-[13px] font-medium transition-colors",
                            slot === s.start ? "border-primary bg-primary text-white" : "border-border bg-card text-foreground hover:border-primary/50"
                          )}
                        >
                          {s.time}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {data && (
                  <p className={cn("inline-block rounded px-1.5 py-0.5 text-[11px]", data.provider.kind === "google" ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>
                    {data.provider.label}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sch-note">Notes (optional)</Label>
            <Textarea id="sch-note" name="note" rows={2} placeholder="What this meeting is for, anything the customer asked to cover…" />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !slot || !leadId}>
              {pending ? "Booking…" : "Book meeting"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
