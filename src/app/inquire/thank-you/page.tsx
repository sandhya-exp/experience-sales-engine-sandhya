import Link from "next/link";
import type { Metadata } from "next";
import { Bot, Check, CheckCircle2, ExternalLink } from "lucide-react";
import { ExperienceLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { getLeadById } from "@/lib/repo/leads";
import { getLatestBrief } from "@/lib/repo/aiBriefs";
import { hasIntelligence } from "@/lib/ai/briefGuards";
import { nextFollowUpFor } from "@/lib/repo/followups";
import { BookingPanel } from "@/components/inquire/booking-panel";
import { recommendMeeting } from "@/lib/calendar/recommend";
import { formatInZone, isValidTimeZone } from "@/lib/calendar/time";
import { schedulingConfig } from "@/lib/calendar/config";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Book a call — Talk to Sales · Experience.com" };

/**
 * Talk to Sales, step two: book the discovery call.
 *
 * Two steps, shown as two steps — choose a time, then confirmed — because a
 * customer who has just filled in a form wants to know how much further there
 * is to go. Between the two, the agent is already working: it read the inquiry
 * when the lead was created, which is what fills the panel beside the calendar,
 * and booking triggers another pass that writes the rep's preparation brief
 * before anyone has looked at the opportunity.
 */
export default async function ThankYouPage({ searchParams }: PageProps<"/inquire/thank-you">) {
  const sp = await searchParams;
  const leadId = typeof sp.lead === "string" ? sp.lead : null;
  const lead = leadId ? await getLeadById(leadId) : null;
  const [followUp, brief] = await Promise.all([
    lead ? nextFollowUpFor(lead.id) : Promise.resolve(null),
    lead ? getLatestBrief(lead.id) : Promise.resolve(null),
  ]);
  const canBook = !!lead && lead.status === "new" && !followUp;
  const error = typeof sp.error === "string" ? sp.error : null;
  const teamTz = schedulingConfig().timeZone;
  const recommendation = recommendMeeting(lead, hasIntelligence(brief) ? brief.intelligence : null);

  const when = followUp ? new Date(followUp.scheduledFor) : null;
  const customerTz = followUp?.calendar?.customer_timezone;
  const showTz = isValidTimeZone(customerTz) ? customerTz : teamTz;
  const booked = Boolean(followUp && when);

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-5xl">
        <Steps booked={booked} />

        <div className="mb-8 flex justify-center">
          <ExperienceLogo />
        </div>

        {booked && when ? (
          <Confirmed
            when={when}
            showTz={showTz}
            teamTz={teamTz}
            repName={followUp?.calendar?.rep_name ?? null}
            durationMinutes={followUp?.calendar?.duration_minutes ?? 30}
            provider={followUp?.calendar?.provider ?? null}
            invited={Boolean(followUp?.calendar?.invited)}
            htmlLink={followUp?.calendar?.html_link ?? null}
            agenda={recommendation.agenda}
          />
        ) : canBook && lead ? (
          <>
            {/* The form was just submitted; say so before showing a calendar.
                Booking is the offer, not the requirement — a customer who
                closes this page has still reached the sales team. */}
            <div className="mb-5 text-center">
              <h1 className="text-[24px] font-bold tracking-tight text-foreground">Thanks — our sales team has your request.</h1>
              <p className="mx-auto mt-1.5 max-w-xl text-[14px] text-muted-foreground">
                We&rsquo;ll be in touch within one business day either way. If you&rsquo;d rather skip the back-and-forth, pick a time below.
              </p>
            </div>
            <BookingPanel leadId={lead.id} recommendation={recommendation} error={error} />
          </>
        ) : (
          <Received />
        )}

        <div className="mt-6 text-center">
          <Button asChild variant="ghost" size="sm">
            <Link href="/inquire">Back to Talk to Sales</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Choose time → Your info, the way a booking flow tells you where you are. */
function Steps({ booked }: { booked: boolean }) {
  return (
    <ol className="mx-auto mb-8 flex max-w-sm items-center">
      {[
        { label: "Choose time", done: true },
        { label: "Confirmed", done: booked },
      ].map((step, i) => (
        <li key={step.label} className={cn("flex items-center", i === 0 && "flex-1")}>
          <div className="flex flex-col items-center gap-1.5">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border-2 text-[11px] font-semibold",
                step.done ? "border-primary bg-primary text-white" : "border-border bg-card text-muted-foreground"
              )}
            >
              {step.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={cn("text-[11px] font-semibold uppercase tracking-wide", step.done ? "text-foreground" : "text-muted-foreground")}>{step.label}</span>
          </div>
          {i === 0 && <span className={cn("mx-2 -mt-5 h-[2px] flex-1", booked ? "bg-primary" : "bg-border")} />}
        </li>
      ))}
    </ol>
  );
}

function Confirmed({
  when,
  showTz,
  teamTz,
  repName,
  durationMinutes,
  provider,
  invited,
  htmlLink,
  agenda,
}: {
  when: Date;
  showTz: string;
  teamTz: string;
  repName: string | null;
  durationMinutes: number;
  provider: string | null;
  invited: boolean;
  htmlLink: string | null;
  agenda: string[];
}) {
  return (
    <div className="mx-auto max-w-xl overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow">
      <div className="px-8 pt-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
          <CheckCircle2 className="h-7 w-7 text-success" />
        </div>
        <h1 className="mt-4 text-[26px] font-bold tracking-tight text-foreground">Booking confirmed</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          {repName ? (
            <>
              You&rsquo;re booked with <span className="font-medium text-foreground">{repName}</span>, Experience.com.
            </>
          ) : (
            <>You&rsquo;re booked with our sales team.</>
          )}
        </p>

        <p className="mt-6 text-[20px] font-bold text-foreground">
          {new Intl.DateTimeFormat("en-US", { timeZone: showTz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(when)}
        </p>
        <p className="mt-0.5 text-[18px] font-semibold text-foreground">{formatInZone(when, showTz, { withDate: false })}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {durationMinutes} minutes
          {showTz !== teamTz && <> · {formatInZone(when, teamTz, { withDate: false })} for our team</>}
        </p>

        <div className="mt-4 space-y-1.5 text-[13px]">
          {provider === "google" && invited && <p className="text-success">A calendar invitation is on its way to your email.</p>}
          {provider === "google" && !invited && <p className="text-muted-foreground">Our team will send the calendar invitation shortly.</p>}
          {provider === "local" && (
            <p className="inline-block rounded bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning">Demo booking — Google Calendar is not configured, so no invitation was sent.</p>
          )}
          {htmlLink && (
            <a href={htmlLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              View in Google Calendar <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {/* What the agent did the moment this was booked. Not a promise — the
          preparation brief is written on the opportunity by the same pass. */}
      <div className="mt-8 border-t border-border bg-muted/30 px-8 py-5 text-left">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
          <Bot className="h-3.5 w-3.5" /> We&rsquo;re already preparing
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-foreground">
          {agenda.length > 0 ? (
            <>
              Your enquiry has been summarised for the specialist you&rsquo;re meeting, along with the {agenda.length === 1 ? "one thing" : `${agenda.length} things`} we
              still want to understand — so the call starts where your form left off.
            </>
          ) : (
            <>Your enquiry has been summarised for the specialist you&rsquo;re meeting, so the call starts where your form left off.</>
          )}
        </p>
        {agenda.length > 0 && (
          <ul className="mt-2.5 space-y-1">
            {agenda.map((item) => (
              <li key={item} className="flex gap-2 text-[13px] text-muted-foreground">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary/60" />
                {item}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[12px] text-muted-foreground">Need a different time? Reply to the confirmation and we&rsquo;ll move it.</p>
      </div>
    </div>
  );
}

/** Nothing to book — the inquiry is in, and a person will pick it up. */
function Received() {
  return (
    <div className="mx-auto max-w-xl rounded-[var(--radius)] border border-border bg-card px-8 py-12 text-center card-shadow">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent">
        <CheckCircle2 className="h-7 w-7 text-primary" />
      </div>
      <h1 className="mt-4 text-[24px] font-bold tracking-tight text-foreground">Thanks — our sales team has your request.</h1>
      <p className="mx-auto mt-2 max-w-md text-[14px] text-muted-foreground">
        A specialist who works with businesses like yours will review it and get in touch within one business day.
      </p>
    </div>
  );
}
