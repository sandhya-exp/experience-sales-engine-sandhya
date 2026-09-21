"use client";

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A field label with a small ⓘ that explains the field on hover/focus.
 * Pure CSS (group-hover) — no extra dependency, works in tables and forms.
 */
export function Hint({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("group relative inline-flex items-center", className)}>
      <button type="button" tabIndex={0} aria-label={text} className="ml-1 inline-flex text-muted-foreground/60 hover:text-foreground focus:text-foreground focus:outline-none">
        <Info className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-50 mb-1.5 w-60 -translate-x-1/2 rounded-md bg-foreground px-2.5 py-1.5 text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-white opacity-0 shadow-md transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

/** One definition per qualification field, used by the Quote Context grid, the AI gaps and the Qualification form. */
export const FIELD_HINTS: Record<string, string> = {
  customer: "The company this opportunity belongs to. One company can have several contacts and opportunities.",
  industry: "The sector the customer chose on the Talk to Sales form. Drives owner routing and which integrations are likely.",
  users: "How many people will use the platform — the main driver of licence quantity.",
  primary_need: "The capability the customer is buying first. The configuration is built around this.",
  deployment: "How the rollout is spread — number of locations, branches, clinics or teams, as stated by the customer.",
  decision_timeline: "When the customer expects to decide. Sets quote validity and urgency.",
  decision_maker: "The person with authority to approve the purchase and sign. Often not the person who submitted the inquiry — confirm on the first call.",
  budget: "The range the customer has in mind. Passed to Quote Ready as context only; it never becomes the quote price.",
  current_solution: "What they use today (or nothing). Shows competitive position and migration effort.",
  integrations: "Systems the customer wants connected — CRM, LOS, practice-management, POS. Detected from their own words; confirm which ones on the call.",
  primary_contact: "The person we are talking to. Receives the quote unless a different decision maker is confirmed.",
  number_of_users: "How many people will use the platform — the main driver of licence quantity.",
};
