import { NextResponse } from "next/server";
import { computeAvailability } from "@/lib/calendar/index";
import { isMeetingDuration } from "@/lib/calendar/recommend";
import { listTeam } from "@/lib/repo/users";

export const dynamic = "force-dynamic";

/**
 * Public: bookable discovery-call slots for the Talk to Sales confirmation page.
 * Returns slot times, which provider produced them, and the names of the sales
 * specialists a customer can choose between — never emails, never who is free
 * for a given slot, and never any calendar event detail. Free/busy is read
 * server-side; the customer sees the collapsed result.
 *
 * An optional `rep` id narrows availability to just that person, the same way
 * the signed-in rep route already narrows by lead owner — a customer who wants
 * to meet a specific specialist sees only when *that person* is free.
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    // The length comes from the browser, so it is checked against the allowed
    // set here rather than trusted — anything else falls back to the default.
    const raw = params.get("minutes");
    const minutes = isMeetingDuration(Number(raw)) ? Number(raw) : undefined;
    const repId = params.get("rep");

    const team = await listTeam();
    // Only the people who actually take calls — routing already hands leads
    // to the first sales-role match, so the picker offers the same set.
    const reps = team.filter((t) => t.role !== "admin");
    const selected = repId ? reps.find((r) => r.id === repId) ?? null : null;

    const a = await computeAvailability({
      minutes,
      onlyCalendars: selected ? [selected.email.toLowerCase()] : undefined,
    });
    return NextResponse.json({
      provider: { kind: a.provider.kind, label: a.provider.label, configured: a.provider.configured },
      timeZone: a.timeZone,
      slotMinutes: a.slotMinutes,
      slots: a.slots.map((s) => ({ start: s.start, end: s.end })),
      reps: reps.map((r) => ({ id: r.id, name: r.name })),
      selectedRep: selected ? { id: selected.id, name: selected.name } : null,
      generatedAt: a.generatedAt,
    });
  } catch (err) {
    console.error("Availability failed:", err);
    return NextResponse.json({ error: "availability_unavailable", message: "Availability could not be loaded right now." }, { status: 503 });
  }
}
