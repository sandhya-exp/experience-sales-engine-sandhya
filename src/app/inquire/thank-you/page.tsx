import Link from "next/link";
import type { Metadata } from "next";
import { Bot, Calendar, Check, CheckCircle2, ExternalLink, Video } from "lucide-react";
import { ExperienceLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { getLeadById } from "@/lib/repo/leads";
import { getLatestBrief } from "@/lib/repo/aiBriefs";
import { hasIntelligence } from "@/lib/ai/briefGuards";
import { nextFollowUpFor } from "@/lib/repo/followups";
import { BookingPanel } from "@/components/inquire/booking-panel";
import { recommendMeeting } from "@/lib/calendar/recommend";
import { CONFERENCE_LABEL, type ConferenceKey } from "@/lib/calendar/conferencing";
import { googleCalendarAddLink } from "@/lib/calendar/addLink";
import { formatInZone, isValidTimeZone } from "@/lib/calendar/time";
import { schedulingConfig } from "@/lib/calendar/config";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Book a call — Talk to Sales · Experience.com" };

/** The customer-oriented version of "what's next" — three steps, in their language, not the system's. */
const WHATS_NEXT = [
  { title: "We review your request", body: "Your specialist reviews the information you shared." },
  { title: "We meet", body: "We'll use the discovery call to understand your goals and requirements." },
  { title: "We prepare your next step", body: "After the conversation, we'll follow up with the appropriate next steps." },
];

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
            conference={followUp?.calendar?.conference ?? null}
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
  conference,
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
  conference?: { kind: ConferenceKey; url: string | null } | null;
  agenda: string[];
}) {
  const end = new Date(when.getTime() + durationMinutes * 60_000);
  const meetingLabel = conference ? CONFERENCE_LABEL[conference.kind] : "Google Meet";
  const joinLink = conference?.url ?? htmlLink;
  const addToCalendarLink = googleCalendarAddLink({
    title: `Discovery call · Experience.com`,
    start: when,
    end,
    location: meetingLabel,
    details: joinLink ? `Join: ${joinLink}` : undefined,
  });

  return (
    <div className="mx-auto max-w-xl overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow">
      <div className="px-5 pt-8 text-center sm:px-8 sm:pt-10">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
          <CheckCircle2 className="h-7 w-7 text-success" />
        </div>
        <h1 className="mt-4 text-[24px] font-bold tracking-tight text-foreground sm:text-[26px]">You&rsquo;re all set</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          {repName ? (
            <>
              We&rsquo;ve scheduled your conversation with <span className="font-medium text-foreground">{repName}</span>, Experience.com.
            </>
          ) : (
            <>We&rsquo;ve scheduled your conversation with our sales team.</>
          )}
        </p>

        <div className="mx-5 mt-6 space-y-2 rounded-lg border border-border bg-muted/30 px-4 py-3.5 text-left sm:mx-8">
          <Row icon={<Calendar className="h-4 w-4 text-primary" />}>
            <span className="font-semibold text-foreground">
              {new Intl.DateTimeFormat("en-US", { timeZone: showTz, weekday: "long", month: "long", day: "numeric" }).format(when)}
            </span>{" "}
            · {formatInZone(when, showTz, { withDate: false })}
            {showTz !== teamTz && <span className="text-muted-foreground"> ({formatInZone(when, teamTz, { withDate: false })} for our team)</span>}
          </Row>
          <Row icon={<Bot className="h-4 w-4 text-primary" />}>
            {durationMinutes} minutes{repName ? ` with ${repName}` : ""}
          </Row>
          <Row icon={<Video className="h-4 w-4 text-primary" />}>{meetingLabel}</Row>
        </div>

        <div className="mt-4 space-y-1.5 text-[13px]">
          {provider === "google" && invited && <p className="text-success">A calendar invitation is on its way to your email.</p>}
          {provider === "google" && !invited && <p className="text-muted-foreground">Our team will send the calendar invitation shortly.</p>}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <a href={addToCalendarLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              Add to Google Calendar <ExternalLink className="h-3 w-3" />
            </a>
            {joinLink && (
              <a href={joinLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                View meeting details <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          {provider === "local" && <p className="text-[11px] text-muted-foreground/70">Demo booking — no calendar invitation was sent.</p>}
        </div>
      </div>

      {/* What happens next, in the customer's language — not the system's. */}
      <div className="mt-6 border-t border-border px-5 py-5 text-left sm:px-8">
        <p className="section-label">What happens next</p>
        <ol className="mt-2.5 space-y-2.5">
          {WHATS_NEXT.map((step, i) => (
            <li key={step.title} className="flex gap-2.5 text-[13px]">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{i + 1}</span>
              <p className="leading-snug text-foreground">
                <span className="font-semibold">{step.title}</span> — <span className="text-muted-foreground">{step.body}</span>
              </p>
            </li>
          ))}
        </ol>
      </div>

      {/* What the agent did the moment this was booked — kept, but compact. */}
      {agenda.length > 0 && (
        <div className="border-t border-border bg-muted/30 px-5 py-4 text-left sm:px-8">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
            <Bot className="h-3.5 w-3.5" /> What we&rsquo;ll cover on the call
          </p>
          <ul className="mt-2 space-y-1">
            {agenda.map((item) => (
              <li key={item} className="flex gap-2 text-[13px] text-muted-foreground">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary/60" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-[12px] text-muted-foreground">Need a different time? Reply to the confirmation and we&rsquo;ll move it.</p>
        </div>
      )}
    </div>
  );
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      {icon}
      <span className="text-foreground">{children}</span>
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
