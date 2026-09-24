/**
 * A "Add to Google Calendar" link that works for anyone, regardless of
 * whether this deployment's own Google Calendar integration is configured or
 * whether an invitation was actually sent — it is Google's own render URL,
 * not an API call, so there is nothing to authenticate and nothing that can
 * fail. Used on the booking confirmation screen.
 */
export function googleCalendarAddLink(input: { title: string; start: Date; end: Date; details?: string; location?: string }): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${fmt(input.start)}/${fmt(input.end)}`,
  });
  if (input.details) params.set("details", input.details);
  if (input.location) params.set("location", input.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
