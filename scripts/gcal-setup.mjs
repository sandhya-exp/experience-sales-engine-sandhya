#!/usr/bin/env node
/**
 * Google Calendar setup doctor.
 *
 *   npm run gcal:check    read-only: can the service account authenticate, and
 *                         which of the sales calendars has actually been shared
 *                         with it?
 *   npm run gcal:setup    the above, plus create a booking calendar the service
 *                         account owns and share it back with you.
 *
 * Why a booking calendar of its own: reading availability only needs
 * "See only free/busy" on each rep's calendar, but creating the discovery-call
 * event needs "Make changes to events" — and a Workspace admin can switch off
 * sharing outside the organisation, which greys that option out. A service
 * account may always create and own a calendar of its own, so the event lands
 * there instead, and the script grants your own account writer access so the
 * bookings show up in your Google Calendar too.
 *
 * Nothing here touches your credentials beyond reading .env.local to sign a
 * short-lived token, exactly as the app does.
 */
import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const API = process.env.GOOGLE_CALENDAR_API_URL || "https://www.googleapis.com";
const TOKEN_URL = API === "https://www.googleapis.com" ? "https://oauth2.googleapis.com/token" : `${API}/token`;
const SCOPE = "https://www.googleapis.com/auth/calendar";
const CREATE = process.argv.includes("--create");

/* ----------------------------------------------------------------- env */

function env() {
  const out = { ...process.env };
  for (const file of [".env.local", ".env"]) {
    const p = path.join(root, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

const E = env();

function serviceAccount() {
  const raw = E.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (raw) {
    const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const p = JSON.parse(text);
    if (!p.client_email || !p.private_key) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON has no client_email / private_key");
    return { email: p.client_email, key: p.private_key };
  }
  if (E.GOOGLE_SERVICE_ACCOUNT_EMAIL && E.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    return { email: E.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: E.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n") };
  }
  throw new Error("No service account in .env.local — set GOOGLE_SERVICE_ACCOUNT_JSON (raw JSON or base64 of the key file).");
}

/* --------------------------------------------------------------- google */

async function token(sa) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: sa.email, scope: SCOPE, aud: TOKEN_URL.replace(/\/token$/, "/token"), iat: now, exp: now + 3600 };
  if (E.GOOGLE_CALENDAR_IMPERSONATE) claims.sub = E.GOOGLE_CALENDAR_IMPERSONATE;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(unsigned), sa.key).toString("base64url");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).access_token;
}

const api = async (tok, p, init = {}) => {
  const res = await fetch(`${API}${p}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${tok}`, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json, text };
};

/* ----------------------------------------------------------------- run */

// One clean line for the things that go wrong most often — a missing key, a
// malformed one, a clock skew — rather than a stack trace.
process.on("uncaughtException", (err) => {
  console.error(`\n${err.message}\n`);
  console.error("See docs/GOOGLE-CALENDAR.md for the setup, or run with the app's .env.local in place.");
  process.exit(1);
});

const sa = serviceAccount();
console.log(`Service account : ${sa.email}`);

const tok = await token(sa);
console.log("Authentication  : ok (token issued)\n");

const calendars = (E.SALES_CALENDARS || "").split(",").map((s) => s.trim()).filter(Boolean);
if (calendars.length === 0) {
  console.log("SALES_CALENDARS is not set, so the app falls back to every email in app_users.");
  console.log("Set it to the calendars that are really shared, e.g. SALES_CALENDARS=you@yourdomain.com\n");
}

if (calendars.length) {
  const from = new Date();
  const to = new Date(Date.now() + 7 * 86400000);
  const fb = await api(tok, "/calendar/v3/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: calendars.map((id) => ({ id })) }),
  });
  if (!fb.ok) {
    console.log(`freeBusy failed (${fb.status}): ${fb.text.slice(0, 200)}`);
  } else {
    console.log("Sales calendars (next 7 days):");
    for (const id of calendars) {
      const c = fb.json.calendars?.[id];
      if (!c || (c.errors ?? []).length) console.log(`  ✗ ${id} — not shared with the service account (its time counts as free until it is)`);
      else console.log(`  ✓ ${id} — shared, ${(c.busy ?? []).length} busy window(s) visible`);
    }
    console.log("");
  }
}

if (!CREATE) {
  console.log("Read-only check. Run `npm run gcal:setup` to create a booking calendar the service account owns.");
  process.exit(0);
}

/* ------------------------------------------------- booking calendar */

const NAME = "Experience.com Sales Engine — Discovery calls";
const tz = E.SALES_TIMEZONE || "America/New_York";

const list = await api(tok, "/calendar/v3/users/me/calendarList");
const existing = (list.json.items ?? []).find((c) => c.summary === NAME);

let calendarId;
if (existing) {
  calendarId = existing.id;
  console.log(`Booking calendar: already exists, reusing it`);
} else {
  const created = await api(tok, "/calendar/v3/calendars", { method: "POST", body: JSON.stringify({ summary: NAME, timeZone: tz }) });
  if (!created.ok) {
    console.log(`Could not create the booking calendar (${created.status}): ${created.text.slice(0, 300)}`);
    process.exit(1);
  }
  calendarId = created.json.id;
  console.log(`Booking calendar: created`);
}

// Share it back, so bookings appear in your own Google Calendar. This is the
// service account sharing what it owns, which no organisation policy blocks.
const owner = (E.GOOGLE_CALENDAR_IMPERSONATE || calendars[0] || "").trim();
if (owner) {
  const acl = await api(tok, `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/acl`, {
    method: "POST",
    body: JSON.stringify({ role: "writer", scope: { type: "user", value: owner } }),
  });
  console.log(acl.ok ? `Shared with     : ${owner} (writer)` : `Could not share with ${owner} (${acl.status}): ${acl.text.slice(0, 200)}`);
}

console.log(`\nAdd this line to .env.local:\n\n  SALES_BOOKING_CALENDAR=${calendarId}\n`);
console.log(`Then restart \`npm run dev\`. To see the bookings in Google Calendar: calendar.google.com →`);
console.log(`Other calendars → + → Subscribe to calendar → paste the same id.`);
