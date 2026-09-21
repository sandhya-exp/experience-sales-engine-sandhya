import { NextResponse } from "next/server";
import { computeAvailability } from "@/lib/calendar/index";

export const dynamic = "force-dynamic";

/**
 * Public: bookable discovery-call slots for the Talk to Sales confirmation page.
 * Returns only slot times and which provider produced them — never who is free,
 * never any calendar event detail. Free/busy is read server-side; the customer
 * sees the collapsed result.
 */
export async function GET() {
  try {
    const a = await computeAvailability();
    return NextResponse.json({
      provider: { kind: a.provider.kind, label: a.provider.label, configured: a.provider.configured },
      timeZone: a.timeZone,
      slotMinutes: a.slotMinutes,
      slots: a.slots.map((s) => ({ start: s.start, end: s.end })),
      generatedAt: a.generatedAt,
    });
  } catch (err) {
    console.error("Availability failed:", err);
    return NextResponse.json({ error: "availability_unavailable", message: "Availability could not be loaded right now." }, { status: 503 });
  }
}
