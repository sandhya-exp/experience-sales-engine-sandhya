import Link from "next/link";
import { CalendarCheck, CheckCircle2, Send } from "lucide-react";
import { addDays, format, isWeekend, setHours, setMinutes, startOfDay } from "date-fns";
import { ExperienceLogo } from "@/components/brand/logo";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getLeadById } from "@/lib/repo/leads";
import { nextFollowUpFor } from "@/lib/repo/followups";
import { bookCustomerSlotAction } from "@/app/actions/followups";
import { formatScheduledTime } from "@/lib/format";

/** Discovery-call slots offered to the customer: next 3 business days, three times each. */
const SLOT_HOURS = [10, 11, 14];
function offeredSlots(now = new Date()) {
  const days: Date[] = [];
  let d = startOfDay(addDays(now, 1));
  while (days.length < 3) {
    if (!isWeekend(d)) days.push(d);
    d = addDays(d, 1);
  }
  return days.map((day) => ({
    day,
    times: SLOT_HOURS.map((h) => setMinutes(setHours(day, h), 0)),
  }));
}

export default async function ThankYouPage({ searchParams }: PageProps<"/inquire/thank-you">) {
  const sp = await searchParams;
  const leadId = typeof sp.lead === "string" ? sp.lead : null;
  const lead = leadId ? await getLeadById(leadId) : null;
  const followUp = lead ? await nextFollowUpFor(lead.id) : null;
  const canBook = !!lead && lead.status === "new" && !followUp;
  const slotError = sp.error === "slot";

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-lg">
        <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
          <ExperienceLogo className="mb-2" />
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent">
            {followUp ? <CheckCircle2 className="h-6 w-6 text-primary" /> : <Send className="h-6 w-6 text-primary" />}
          </div>

          {followUp ? (
            <>
              <h1 className="text-2xl font-semibold text-foreground">You&apos;re booked</h1>
              <div className="w-full rounded-lg border border-border bg-muted/50 px-4 py-3 text-left">
                <p className="section-label">Appointment booked</p>
                <p className="mt-0.5 text-[15px] font-semibold text-foreground">
                  {followUp.title} · {formatScheduledTime(followUp.scheduledFor)}
                </p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {format(new Date(followUp.scheduledFor), "EEEE, MMMM d, yyyy")} · 30 minutes · auto-confirmed
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                One of our specialists will call you at the number you provided. If you need a different time, just reply to
                the confirmation from our team.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-foreground">Thank you — your inquiry has been received.</h1>
              <p className="text-sm text-muted-foreground">
                A member of the Experience.com team will review your request and get in touch with you.
              </p>
            </>
          )}

          {canBook && (
            <div className="mt-2 w-full text-left">
              <div className="mb-3 flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold text-foreground">Want to skip the back-and-forth? Pick a time for a 30-minute discovery call.</p>
              </div>
              {slotError && <p className="mb-2 text-xs text-destructive">That time isn&apos;t available anymore — please choose another.</p>}
              <div className="space-y-2.5">
                {offeredSlots().map(({ day, times }) => (
                  <div key={day.toISOString()} className="grid grid-cols-[6.5rem_1fr] items-center gap-2">
                    <p className="text-[13px] font-medium text-foreground">{format(day, "EEE, MMM d")}</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {times.map((t) => (
                        <form key={t.toISOString()} action={bookCustomerSlotAction.bind(null, lead.id)}>
                          <input type="hidden" name="slot" value={t.toISOString()} />
                          <button
                            type="submit"
                            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
                          >
                            {format(t, "h:mm a")}
                          </button>
                        </form>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Booking is optional — we&apos;ll reach out either way.
              </p>
            </div>
          )}

          <Button asChild variant="outline" className="mt-2">
            <Link href="/inquire">Back</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
