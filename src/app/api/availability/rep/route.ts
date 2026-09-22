import { NextResponse } from "next/server";
import { computeAvailability } from "@/lib/calendar/index";
import { isMeetingDuration } from "@/lib/calendar/recommend";
import { requireUser } from "@/lib/authz";
import { getLeadById } from "@/lib/repo/leads";
import { listTeam } from "@/lib/repo/users";

export const dynamic = "force-dynamic";

/**
 * Availability for *one* salesperson — the rep-side counterpart of the public
 * endpoint a customer uses.
 *
 * The customer-facing route answers "when is the team free", because whoever is
 * free takes the call. Booking on behalf of a named opportunity is a different
 * question: the person who owns it is the person who has to be there, so
 * free/busy is read from their calendar alone and the office-hours window still
 * applies. Signed-in only — unlike the public route, this one identifies who is
 * free, which is internal information.
 */
export async function GET(request: Request) {
  await requireUser();
  const url = new URL(request.url);
  const leadId = url.searchParams.get("lead");
  const raw = url.searchParams.get("minutes");
  const minutes = isMeetingDuration(Number(raw)) ? Number(raw) : undefined;

  try {
    const lead = leadId ? await getLeadById(leadId) : null;
    const team = await listTeam();
    const owner = lead?.owner_user_id ? team.find((t) => t.id === lead.owner_user_id) ?? null : null;

    const a = await computeAvailability({
      minutes,
      // Unassigned opportunities fall back to the whole team: somebody has to be
      // able to book the call, and refusing would be the wrong answer.
      onlyCalendars: owner ? [owner.email.toLowerCase()] : undefined,
    });
    return NextResponse.json({
      provider: { kind: a.provider.kind, label: a.provider.label, configured: a.provider.configured },
      timeZone: a.timeZone,
      slotMinutes: a.slotMinutes,
      owner: owner ? { id: owner.id, name: owner.name } : null,
      slots: a.slots.map((s) => ({ start: s.start, end: s.end })),
      generatedAt: a.generatedAt,
    });
  } catch (err) {
    console.error("Rep availability failed:", err);
    return NextResponse.json({ error: "availability_unavailable", message: "Availability could not be loaded right now." }, { status: 503 });
  }
}
