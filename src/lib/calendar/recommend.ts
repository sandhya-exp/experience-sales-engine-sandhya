import type { Lead } from "@/lib/types";
import type { OpportunityIntelligence, QualField } from "@/lib/ai/intelligence";

/**
 * What the agent decides about the discovery call, before the customer books it.
 *
 * The moment an inquiry is submitted the agent has already read it: the brief is
 * generated on lead creation, so by the time the customer reaches the booking
 * screen there is a summary, a list of what is still unknown and a next action.
 * Booking is the first point where that work is useful to the *customer* rather
 * than only to the salesperson — so this turns it into two things they can see:
 * how long the call should be, and what it will cover.
 *
 * Deterministic and explainable on purpose. Every output traces to a count of
 * open questions or a number the customer typed into the form; nothing is
 * generated, and nothing that isn't already on the record appears here. The
 * agenda is phrased for a customer, from a fixed map — an internal gap label
 * ("Budget range — no budget context for the quote") is never shown to them.
 */

export const MEETING_DURATIONS = [15, 30, 60] as const;
export type MeetingDuration = (typeof MEETING_DURATIONS)[number];

export function isMeetingDuration(n: unknown): n is MeetingDuration {
  return MEETING_DURATIONS.includes(Number(n) as MeetingDuration);
}

/** Customer-facing wording for each qualification gap. Anything unmapped is left out. */
const TOPIC: Record<QualField, string | null> = {
  contact: null, // "who should we email" is not worth a line on an agenda
  number_of_users: "How many people would be using it",
  primary_need: "What you want it to do first",
  decision_timeline: "When you'd want to be live",
  decision_maker: "Who else should be involved",
  budget: "What kind of investment you're planning for",
  current_solution: "What you're using today",
};

export interface MeetingRecommendation {
  /** The length the agent recommends, pre-selected on the booking screen. */
  minutes: MeetingDuration;
  /** One sentence, in the customer's language, for why that length. */
  reason: string;
  /** What the call will cover — the open questions, phrased for a customer. */
  agenda: string[];
  /** The agent's one-line read of the inquiry, or null if there is no brief yet. */
  summary: string | null;
  /** How many qualification questions are still open. Drives `minutes`. */
  openCount: number;
}

export function recommendMeeting(lead: Lead | null, intelligence: OpportunityIntelligence | null): MeetingRecommendation {
  const agenda = buildAgenda(intelligence);
  const openCount = agenda.length;
  const users = lead?.number_of_users ?? 0;

  // Two inputs, in this order: how much is genuinely unknown, then how big the
  // deployment is. A large rollout needs longer even when the form was thorough,
  // because the conversation is about how it works, not only what is missing.
  let minutes: MeetingDuration = openCount <= 2 ? 15 : openCount <= 5 ? 30 : 60;
  let reason =
    openCount === 0
      ? "Your form covered everything we'd normally ask, so this can be a short one."
      : openCount <= 2
        ? `There ${openCount === 1 ? "is one thing" : "are a couple of things"} we'd like to understand, so 15 minutes should do it.`
        : openCount <= 5
          ? "There are a handful of things we'd like to understand, so we've set aside 30 minutes."
          : "There's a fair amount to cover, so we've set aside a full hour.";

  if (users >= 500 && minutes < 60) {
    minutes = 60;
    reason = `A rollout to ${users.toLocaleString("en-US")} people is worth an hour — there's usually more to work through than a form can capture.`;
  } else if (users >= 150 && minutes < 30) {
    minutes = 30;
    reason = `With ${users.toLocaleString("en-US")} people using it, 30 minutes gives us room to go into how it would actually work.`;
  }

  return { minutes, reason, agenda, summary: summaryOf(intelligence), openCount };
}

function buildAgenda(intelligence: OpportunityIntelligence | null): string[] {
  if (!intelligence) return [];
  const out: string[] = [];
  for (const gap of intelligence.gaps.missing) {
    // An integration the customer described but never named is the single most
    // useful thing to settle on a call, so it is phrased in its own right.
    if (gap.label === "Required integration") {
      out.push("Which systems this would need to connect to");
      continue;
    }
    const topic = gap.field ? TOPIC[gap.field] : null;
    if (topic && !out.includes(topic)) out.push(topic);
  }
  return out.slice(0, 6);
}

function summaryOf(intelligence: OpportunityIntelligence | null): string | null {
  const need = intelligence?.customer_need?.trim();
  return need ? need : null;
}
