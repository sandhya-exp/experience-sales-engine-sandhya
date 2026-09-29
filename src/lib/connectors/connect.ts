import { getSetting, setSetting } from "@/lib/repo/settings";
import type { ConnectField, ConnectSpec } from "@/lib/connectors/types";

/**
 * Connecting a built-in connector from inside the app: the fields it needs,
 * a real check against the vendor's API before anything is saved, and the
 * saved credentials afterwards (server-only, in app_settings). A connector
 * is "connected" only when the check passed — the vendor told us who we
 * are — so nothing here is a mock. Environment variables still work and
 * take precedence for deployments that prefer them.
 */
export interface SavedConnection {
  values: Record<string, string>;
  /** What the vendor said we are connected as: a mailbox, a workspace, a portal. */
  account: string | null;
  verifiedAt: string;
}

const KEY = (k: string) => `connectors.credentials.${k}`;

export async function getConnection(key: string): Promise<SavedConnection | null> {
  return getSetting<SavedConnection | null>(KEY(key), null);
}
export async function saveConnection(key: string, c: SavedConnection) {
  return setSetting(KEY(key), c);
}
export async function clearConnection(key: string) {
  return setSetting<SavedConnection | null>(KEY(key), null);
}

export interface VerifyResult {
  ok: boolean;
  account: string | null;
  error?: string;
}

const f = (key: string, label: string, opts: Partial<ConnectField> = {}): ConnectField => ({ key, label, secret: false, ...opts });

async function getJson(url: string, init: RequestInit, timeoutMs = 8000): Promise<{ status: number; body: Record<string, unknown> }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, cache: "no-store" });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

const fail = (error: string): VerifyResult => ({ ok: false, account: null, error });

/** Specs keyed by connector key. Fields map 1:1 to the env vars the same connector accepts. */
export const CONNECT_SPECS: Record<string, ConnectSpec & { verify: (v: Record<string, string>) => Promise<VerifyResult> }> = {
  gmail: {
    intro: "Connect Gmail to let Sales Engine AI search customer conversations in a rep's mailbox and create follow-up drafts there.",
    capabilities: ["Search emails", "Read conversation context", "Draft follow-up emails"],
    docsUrl: "https://developers.google.com/gmail/api/auth/about-auth",
    help: "Create an OAuth client in Google Cloud (Gmail API enabled), then mint a refresh token for the mailbox with the gmail.readonly and gmail.compose scopes — the OAuth 2.0 Playground is the quickest way.",
    fields: [f("GMAIL_OAUTH_CLIENT_ID", "OAuth client ID", { placeholder: "xxxx.apps.googleusercontent.com" }), f("GMAIL_OAUTH_CLIENT_SECRET", "OAuth client secret", { secret: true }), f("GMAIL_REFRESH_TOKEN", "Refresh token for the mailbox", { secret: true })],
    async verify(v) {
      const tok = await getJson("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: v.GMAIL_OAUTH_CLIENT_ID, client_secret: v.GMAIL_OAUTH_CLIENT_SECRET, refresh_token: v.GMAIL_REFRESH_TOKEN, grant_type: "refresh_token" }).toString(),
      });
      if (tok.status !== 200 || typeof tok.body.access_token !== "string") return fail(`Google refused the refresh token (${tok.status}${tok.body.error ? ` ${String(tok.body.error)}` : ""}).`);
      const me = await getJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: `Bearer ${tok.body.access_token}` } });
      if (me.status !== 200) return fail(`Token works but Gmail refused users/me/profile (${me.status}) — is the Gmail API enabled and the scope granted?`);
      return { ok: true, account: typeof me.body.emailAddress === "string" ? me.body.emailAddress : "Gmail mailbox" };
    },
  },
  slack: {
    intro: "Connect Slack so the Sales Engine can notify a channel when a lead arrives, a quote needs approval or a deal is won.",
    capabilities: ["Post notifications to a channel", "Flow Builder — Notify node"],
    docsUrl: "https://api.slack.com/apps",
    help: "Create a Slack app, add the chat:write scope, install it to the workspace and paste the Bot User OAuth Token (starts with xoxb-). Invite the bot to the default channel.",
    fields: [f("SLACK_BOT_TOKEN", "Bot user OAuth token", { secret: true, placeholder: "xoxb-…" }), f("SLACK_DEFAULT_CHANNEL", "Default channel", { placeholder: "#sales" })],
    async verify(v) {
      const r = await getJson("https://slack.com/api/auth.test", { method: "POST", headers: { authorization: `Bearer ${v.SLACK_BOT_TOKEN}` } });
      if (r.status !== 200 || r.body.ok !== true) return fail(`Slack auth.test failed${r.body.error ? `: ${String(r.body.error)}` : ` (${r.status})`}.`);
      return { ok: true, account: [r.body.team, r.body.user].filter((x) => typeof x === "string").join(" · ") || "Slack workspace" };
    },
  },
  hubspot: {
    intro: "Connect HubSpot to import contacts and companies from your portal and keep deal stages in sync.",
    capabilities: ["Read contacts and companies", "Read deals by pipeline stage", "External contacts import"],
    docsUrl: "https://developers.hubspot.com/docs/api/private-apps",
    help: "In HubSpot go to Settings → Integrations → Private apps, create one with crm.objects.contacts.read, crm.objects.companies.read and crm.objects.deals.read, and paste its access token.",
    fields: [f("HUBSPOT_ACCESS_TOKEN", "Private app access token", { secret: true, placeholder: "pat-…" })],
    async verify(v) {
      const r = await getJson("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", { headers: { authorization: `Bearer ${v.HUBSPOT_ACCESS_TOKEN}` } });
      if (r.status !== 200) return fail(`HubSpot refused the token (${r.status}${r.body.message ? `: ${String(r.body.message).slice(0, 120)}` : ""}).`);
      const info = await getJson("https://api.hubapi.com/account-info/v3/details", { headers: { authorization: `Bearer ${v.HUBSPOT_ACCESS_TOKEN}` } });
      const portal = info.status === 200 && info.body.portalId ? `portal ${String(info.body.portalId)}` : "HubSpot portal";
      return { ok: true, account: portal };
    },
  },
  salesforce: {
    intro: "Connect Salesforce to pull accounts, contacts and opportunities from your org and push won deals back.",
    capabilities: ["Read accounts, contacts and opportunities", "Create or update opportunities (with approval)", "External contacts import"],
    docsUrl: "https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm",
    help: "Create a Connected App with the api and refresh_token scopes, complete the OAuth web-server flow once to obtain a refresh token, and paste the org's instance URL (https://yourorg.my.salesforce.com).",
    fields: [f("SALESFORCE_INSTANCE_URL", "Instance URL", { placeholder: "https://yourorg.my.salesforce.com" }), f("SALESFORCE_CLIENT_ID", "Connected app consumer key"), f("SALESFORCE_CLIENT_SECRET", "Consumer secret", { secret: true }), f("SALESFORCE_REFRESH_TOKEN", "Refresh token", { secret: true })],
    async verify(v) {
      let base: string;
      try {
        base = new URL(v.SALESFORCE_INSTANCE_URL).origin;
      } catch {
        return fail("Instance URL must be a full https:// URL.");
      }
      const tok = await getJson(`${base}/services/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", client_id: v.SALESFORCE_CLIENT_ID, client_secret: v.SALESFORCE_CLIENT_SECRET, refresh_token: v.SALESFORCE_REFRESH_TOKEN }).toString(),
      });
      if (tok.status !== 200 || typeof tok.body.access_token !== "string") return fail(`Salesforce refused the refresh token (${tok.status}${tok.body.error_description ? `: ${String(tok.body.error_description)}` : ""}).`);
      const who = await getJson(`${tok.body.instance_url ?? base}/services/oauth2/userinfo`, { headers: { authorization: `Bearer ${tok.body.access_token}` } });
      const account = who.status === 200 && typeof who.body.preferred_username === "string" ? who.body.preferred_username : new URL(String(tok.body.instance_url ?? base)).host;
      return { ok: true, account };
    },
  },
};

/** Client-safe view of a spec (no verify function). */
export function connectSpec(key: string): ConnectSpec | undefined {
  const s = CONNECT_SPECS[key];
  return s ? { intro: s.intro, capabilities: s.capabilities, docsUrl: s.docsUrl, help: s.help, fields: s.fields } : undefined;
}
