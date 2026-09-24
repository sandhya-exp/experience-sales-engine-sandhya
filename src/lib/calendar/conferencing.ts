/**
 * How a discovery call happens — shared between the two places that offer the
 * choice: a salesperson booking from the workspace (`NewScheduleDialog`) and a
 * customer booking their own call (`BookingPanel`). One list, so the option a
 * rep sees is the option a customer sees, and `bookDiscoveryCall` only ever
 * has to understand one shape.
 *
 * "meet" rides the Google Calendar integration this app already has — Google
 * creates the link on the event itself. Zoom and Teams would each need their
 * own OAuth application, so for those whoever is booking pastes their own
 * room link, and it travels with the event and the invitation.
 */
export const CONFERENCING = [
  { key: "meet", label: "Google Meet", hint: "Created on the event by Google Calendar." },
  { key: "zoom", label: "Zoom", hint: "Paste your Zoom room link." },
  { key: "teams", label: "Microsoft Teams", hint: "Paste your Teams meeting link." },
  { key: "none", label: "No video", hint: "Phone, or a location agreed separately." },
] as const;

export type ConferenceKey = (typeof CONFERENCING)[number]["key"];

export function isConferenceKey(v: unknown): v is ConferenceKey {
  return CONFERENCING.some((c) => c.key === v);
}

export const CONFERENCE_LABEL: Record<ConferenceKey, string> = {
  meet: "Google Meet",
  zoom: "Zoom",
  teams: "Microsoft Teams",
  none: "No video — phone or in person",
};
