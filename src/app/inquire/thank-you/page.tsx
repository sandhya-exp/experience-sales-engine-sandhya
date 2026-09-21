import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, ExternalLink, Send } from "lucide-react";
import { ExperienceLogo } from "@/components/brand/logo";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getLeadById } from "@/lib/repo/leads";
import { nextFollowUpFor } from "@/lib/repo/followups";
import { SlotPicker } from "@/components/inquire/slot-picker";
import { formatInZone, isValidTimeZone } from "@/lib/calendar/time";
import { schedulingConfig } from "@/lib/calendar/config";

export const metadata: Metadata = { title: "Thanks — Talk to Sales · Experience.com" };

/**
 * Talk to Sales confirmation. Offers a discovery-call slot from live team
 * availability (SlotPicker); once booked, shows the appointment in the
 * customer's own time zone with the team's zone alongside.
 */
export default async function ThankYouPage({ searchParams }: PageProps<"/inquire/thank-you">) {
  const sp = await searchParams;
  const leadId = typeof sp.lead === "string" ? sp.lead : null;
  const lead = leadId ? await getLeadById(leadId) : null;
  const followUp = lead ? await nextFollowUpFor(lead.id) : null;
  const canBook = !!lead && lead.status === "new" && !followUp;
  const error = typeof sp.error === "string" ? sp.error : null;
  const teamTz = schedulingConfig().timeZone;

  const when = followUp ? new Date(followUp.scheduledFor) : null;
  const customerTz = followUp?.calendar?.customer_timezone;
  const showTz = isValidTimeZone(customerTz) ? customerTz : teamTz;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-lg">
        <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
          <ExperienceLogo className="mb-2" />
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent">
            {followUp ? <CheckCircle2 className="h-6 w-6 text-primary" /> : <Send className="h-6 w-6 text-primary" />}
          </div>

          {followUp && when ? (
            <>
              <h1 className="text-2xl font-semibold text-foreground">You&apos;re booked</h1>
              <div className="w-full rounded-lg border border-border bg-muted/50 px-4 py-3 text-left">
                <p className="section-label">Discovery call</p>
                <p className="mt-0.5 text-[15px] font-semibold text-foreground">{formatInZone(when, showTz)}</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {new Intl.DateTimeFormat("en-US", { timeZone: showTz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(when)} · {followUp.calendar?.duration_minutes ?? 30} minutes
                  {showTz !== teamTz && <> · {formatInZone(when, teamTz, { withDate: false })} for our team</>}
                </p>
                {followUp.calendar?.rep_name && <p className="mt-1 text-[13px] text-muted-foreground">With {followUp.calendar.rep_name}, Experience.com</p>}
                {followUp.calendar?.provider === "google" && followUp.calendar.invited && (
                  <p className="mt-1 text-[13px] text-success">A calendar invitation is on its way to your email.</p>
                )}
                {followUp.calendar?.provider === "google" && !followUp.calendar.invited && (
                  <p className="mt-1 text-[13px] text-muted-foreground">Our team will send the calendar invitation shortly.</p>
                )}
                {followUp.calendar?.provider === "local" && (
                  <p className="mt-1 inline-block rounded bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning">Demo booking — Google Calendar is not configured, so no invitation was sent.</p>
                )}
                {followUp.calendar?.html_link && (
                  <a href={followUp.calendar.html_link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
                    View in Google Calendar <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <p className="text-sm text-muted-foreground">If you need a different time, just reply to the confirmation from our team.</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-foreground">Thanks — our sales team has your request.</h1>
              <p className="text-sm text-muted-foreground">A specialist who works with businesses like yours will review it and get in touch within one business day.</p>
            </>
          )}

          {canBook && lead && <SlotPicker leadId={lead.id} error={error} />}

          <Button asChild variant="outline" className="mt-2">
            <Link href="/inquire">Back to Talk to Sales</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
