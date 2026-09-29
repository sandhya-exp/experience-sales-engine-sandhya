import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { refreshOpportunity, type RefreshOptions } from "@/lib/ai/agent";

/**
 * Run the agent loop for a lead *after* the response has been sent.
 *
 * Saving a qualification field, booking a call or creating a lead changes what
 * the AI should say next, and the loop must run — but the person who clicked
 * Save did not ask to watch it run. The write returns in well under a second;
 * the intelligence regenerates in the background (Next.js `after()` keeps the
 * function alive for it on Vercel), and the page shows "Updating AI
 * intelligence…" until the new brief lands (see `lib/ai/staleness.ts`).
 *
 * Exactly the same `refreshOpportunity` runs — every stage, every guardrail,
 * every fallback. Only *when* it runs relative to the HTTP response changes.
 *
 * Outside a request (seed scripts, evals) there is no "after", so the refresh
 * runs inline and is awaited, which is what those callers always did.
 */
export async function scheduleRefresh(leadId: string, opts: RefreshOptions = {}, paths: string[] = []): Promise<void> {
  const run = async () => {
    try {
      await refreshOpportunity(leadId, opts);
    } catch (err) {
      console.error(`Background AI refresh failed for lead ${leadId} (non-fatal):`, err);
    }
    // The pages are dynamic, so a poll re-reads the database anyway; this is
    // belt-and-braces for anything the router cached.
    for (const p of [`/leads/${leadId}`, ...paths]) {
      try {
        revalidatePath(p);
      } catch {
        /* not in a request scope */
      }
    }
  };
  try {
    after(run);
  } catch {
    await run();
  }
}
