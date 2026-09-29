import { SALES_TOOLS } from "@/lib/ai/salesTools";
import { emailProvider } from "@/lib/email/provider";
import { getSetting, setSetting } from "@/lib/repo/settings";
import { probeMcpServer } from "@/lib/connectors/mcpClient";
import type { ConnectorInfo, ConnectorStatus, ConnectorToolInfo, CustomServer, WorkflowNode } from "@/lib/connectors/types";

/**
 * The connector registry — one place that knows which external systems the
 * Sales Engine can talk to, what each exposes as MCP tools, whether it is
 * actually configured, and which features use it.
 *
 * Honest by construction: a connector is "connected" only when its
 * credentials are present (and, for a custom MCP server, when it answered
 * `tools/list`). Nothing here pretends. Built-in connectors describe their
 * tools statically; the Sales Engine connector's tools *are* the registry
 * the AI already runs on (lib/ai/salesTools.ts) and the same list the
 * /api/mcp endpoint serves.
 */
const env = (k: string) => Boolean(process.env[k]?.trim());
const envRow = (keys: string[]) => keys.map((key) => ({ key, present: env(key) }));

interface BuiltIn {
  key: string;
  name: string;
  vendor: string;
  category: ConnectorInfo["category"];
  description: string;
  usedBy: string[];
  tools: ConnectorToolInfo[];
  requiredEnv: string[];
  docsUrl?: string;
  status: () => Promise<ConnectorStatus>;
}

const tool = (name: string, description: string, kind: ConnectorToolInfo["kind"], inputs: string[] = []): ConnectorToolInfo => ({ name, description, kind, inputs });

const BUILT_INS: BuiltIn[] = [
  {
    key: "sales_engine",
    name: "Experience.com Sales Engine",
    vendor: "Experience.com",
    category: "internal",
    description: "The Sales Engine's own record — leads, companies, contacts, activities, price list and deal history — exposed as MCP tools for the AI agent and for external MCP clients.",
    usedBy: ["AI Deal Brief", "AI Actions (propose / approve)", "Prepare quote with AI", "MCP endpoint /api/mcp"],
    tools: SALES_TOOLS.map((t) => ({ name: t.name, description: t.description, kind: t.kind, inputs: Object.keys(t.input_schema.properties) })),
    requiredEnv: ["DATABASE_URL", "MCP_API_KEY"],
    async status() {
      const ok = env("DATABASE_URL");
      return {
        state: ok ? "connected" : "error",
        detail: ok ? `${SALES_TOOLS.length} tools served at /api/mcp${env("MCP_API_KEY") ? " (Bearer MCP_API_KEY)" : " — set MCP_API_KEY to allow external clients"}` : "DATABASE_URL is not set.",
        env: envRow(["DATABASE_URL", "MCP_API_KEY"]),
      };
    },
  },
  {
    key: "email",
    name: "Email delivery",
    vendor: "Resend",
    category: "email",
    description: "Sends the messages the AI drafts and a person approves. In development the provider records messages instead of delivering them.",
    usedBy: ["AI Actions — approve & send", "Approvals queue", "Quote emails"],
    tools: [tool("create_email_draft", "Draft an email to a contact, grounded in the opportunity record", "draft", ["lead_id", "contact_id", "intent"]), tool("send_email", "Send an approved email to a contact", "request", ["to", "subject", "body"])],
    requiredEnv: ["EMAIL_PROVIDER", "RESEND_API_KEY", "EMAIL_FROM"],
    async status() {
      const p = emailProvider();
      const live = p.mode === "live";
      return {
        state: live ? "connected" : "demo",
        detail: live ? `Live via ${p.name}` : "Development provider — messages are recorded, not delivered. Set EMAIL_PROVIDER=resend with RESEND_API_KEY and EMAIL_FROM.",
        env: envRow(["EMAIL_PROVIDER", "RESEND_API_KEY", "EMAIL_FROM"]),
      };
    },
  },
  {
    key: "gmail",
    name: "Gmail",
    vendor: "Google",
    category: "email",
    description: "Read a rep's inbox for customer replies and create drafts in their own Gmail. Requires a Google OAuth client and a per-user refresh token.",
    usedBy: ["Inbound reply capture (alternative to the email webhook)", "Flow Builder — Gmail Draft node"],
    tools: [tool("search_emails", "Search a mailbox for messages from a contact or about a company", "read", ["query", "max_results"]), tool("create_email_draft", "Create a draft in the rep's Gmail", "draft", ["to", "subject", "body"]), tool("get_thread", "Read a thread", "read", ["thread_id"])],
    requiredEnv: ["GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"],
    docsUrl: "https://developers.google.com/gmail/api",
    async status() {
      const keys = ["GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"];
      const missing = keys.filter((k) => !env(k));
      return { state: missing.length ? "not_connected" : "connected", detail: missing.length ? `Not connected — missing ${missing.join(", ")}.` : "OAuth credentials present.", env: envRow(keys) };
    },
  },
  {
    key: "google_calendar",
    name: "Google Calendar",
    vendor: "Google",
    category: "calendar",
    description: "Reads rep availability and books discovery calls on the shared sales calendar through a service account.",
    usedBy: ["Public booking page (/inquire)", "Schedule follow-up", "AI Actions — prepare for the call", "Flow Builder — Calendar node"],
    tools: [tool("get_calendar_availability", "Free slots across the sales team's calendars", "read", ["rep", "from", "to"]), tool("create_calendar_event", "Book a call with a Meet link and invite the contact", "request", ["lead_id", "start", "duration", "title"])],
    requiredEnv: ["GOOGLE_SERVICE_ACCOUNT_JSON", "SALES_BOOKING_CALENDAR"],
    async status() {
      const keys = ["GOOGLE_SERVICE_ACCOUNT_JSON", "SALES_BOOKING_CALENDAR", "SALES_CALENDARS"];
      const account = env("GOOGLE_SERVICE_ACCOUNT_JSON") || (env("GOOGLE_SERVICE_ACCOUNT_EMAIL") && env("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"));
      const booking = env("SALES_BOOKING_CALENDAR");
      const reps = (process.env.SALES_CALENDARS ?? "").split(",").map((x) => x.trim()).filter(Boolean).length;
      const ok = account && booking;
      return {
        state: ok ? "connected" : "demo",
        detail: ok ? `Service account · booking calendar set · ${reps} rep calendar${reps === 1 ? "" : "s"} for availability` : "Not configured — availability falls back to business hours and bookings are recorded without a calendar event.",
        env: envRow(keys),
      };
    },
  },
  {
    key: "slack",
    name: "Slack",
    vendor: "Slack",
    category: "messaging",
    description: "Notify a channel when a lead arrives, a quote needs approval or a deal is won.",
    usedBy: ["Notifications (new inquiry, approval needed, won)", "Flow Builder — Notify node"],
    tools: [tool("send_notification", "Post a message to a channel", "request", ["channel", "text"])],
    requiredEnv: ["SLACK_BOT_TOKEN", "SLACK_DEFAULT_CHANNEL"],
    docsUrl: "https://api.slack.com/apps",
    async status() {
      const keys = ["SLACK_BOT_TOKEN", "SLACK_DEFAULT_CHANNEL"];
      const missing = keys.filter((k) => !env(k));
      return { state: missing.length ? "not_connected" : "connected", detail: missing.length ? `Not connected — missing ${missing.join(", ")}.` : "Bot token present.", env: envRow(keys) };
    },
  },
  {
    key: "salesforce",
    name: "Salesforce",
    vendor: "Salesforce",
    category: "crm",
    description: "Pull accounts, contacts and opportunities from an existing Salesforce org, and push won deals back.",
    usedBy: ["Contacts — External contacts import", "Deal history (ACV) for renewals"],
    tools: [tool("get_contacts", "Contacts, filtered by account or email", "read", ["account", "email"]), tool("get_companies", "Accounts", "read", ["query"]), tool("get_opportunities", "Opportunities by account or stage", "read", ["account", "stage"]), tool("upsert_opportunity", "Create or update an opportunity", "request", ["account", "name", "stage", "amount"])],
    requiredEnv: ["SALESFORCE_INSTANCE_URL", "SALESFORCE_CLIENT_ID", "SALESFORCE_CLIENT_SECRET", "SALESFORCE_REFRESH_TOKEN"],
    docsUrl: "https://developer.salesforce.com/docs/apis",
    async status() {
      const keys = ["SALESFORCE_INSTANCE_URL", "SALESFORCE_CLIENT_ID", "SALESFORCE_CLIENT_SECRET", "SALESFORCE_REFRESH_TOKEN"];
      const missing = keys.filter((k) => !env(k));
      return { state: missing.length ? "not_connected" : "connected", detail: missing.length ? `Not connected — missing ${missing.join(", ")}.` : "Connected app credentials present.", env: envRow(keys) };
    },
  },
  {
    key: "hubspot",
    name: "HubSpot",
    vendor: "HubSpot",
    category: "crm",
    description: "Import contacts and companies from a HubSpot portal and keep deal stages in sync.",
    usedBy: ["Contacts — External contacts import", "Contacts — CSV import (HubSpot exports are recognised)"],
    tools: [tool("get_contacts", "Contacts, most recently updated first", "read", ["limit", "after"]), tool("get_companies", "Companies", "read", ["query"]), tool("get_opportunities", "Deals by pipeline stage", "read", ["stage"])],
    requiredEnv: ["HUBSPOT_ACCESS_TOKEN"],
    docsUrl: "https://developers.hubspot.com/docs/api/private-apps",
    async status() {
      const ok = env("HUBSPOT_ACCESS_TOKEN");
      return { state: ok ? "connected" : "not_connected", detail: ok ? "Private app token present." : "Not connected — set HUBSPOT_ACCESS_TOKEN (private app).", env: envRow(["HUBSPOT_ACCESS_TOKEN"]) };
    },
  },
];

/* ---------------------------------------------------------------- state */

const DISABLED_KEY = "connectors.disabled";
const CUSTOM_KEY = "connectors.custom";

export async function disabledConnectors(): Promise<string[]> {
  return getSetting<string[]>(DISABLED_KEY, []);
}
export async function setConnectorEnabled(key: string, enabled: boolean) {
  const current = await disabledConnectors();
  const next = enabled ? current.filter((k) => k !== key) : [...new Set([...current, key])];
  return setSetting(DISABLED_KEY, next);
}
export async function customServers(): Promise<CustomServer[]> {
  return getSetting<CustomServer[]>(CUSTOM_KEY, []);
}
export async function saveCustomServers(list: CustomServer[]) {
  return setSetting(CUSTOM_KEY, list);
}

/** Probe a custom server and record what it answered. */
export async function testCustomServer(id: string): Promise<CustomServer | null> {
  const list = await customServers();
  const s = list.find((x) => x.id === id);
  if (!s) return null;
  const probe = await probeMcpServer(s.url, s.bearerToken);
  const next: CustomServer = { ...s, tools: probe.ok ? probe.tools : s.tools, lastCheckedAt: new Date().toISOString(), lastError: probe.ok ? null : probe.error, serverName: probe.serverName ?? s.serverName ?? null, protocolVersion: probe.protocolVersion ?? s.protocolVersion ?? null };
  await saveCustomServers(list.map((x) => (x.id === id ? next : x)));
  return next;
}

/* ---------------------------------------------------------------- reads */

export async function listConnectors(): Promise<ConnectorInfo[]> {
  const [disabled, custom] = await Promise.all([disabledConnectors(), customServers()]);
  const builtIns = await Promise.all(
    BUILT_INS.map(async (b) => {
      const status = await b.status();
      const enabled = !disabled.includes(b.key);
      return {
        key: b.key,
        name: b.name,
        vendor: b.vendor,
        category: b.category,
        description: b.description,
        usedBy: b.usedBy,
        tools: b.tools,
        status: enabled ? status : { ...status, state: "disabled" as const, detail: `Switched off — ${status.detail}` },
        enabled,
        custom: false,
        docsUrl: b.docsUrl,
      } satisfies ConnectorInfo;
    })
  );
  const customs: ConnectorInfo[] = custom.map((c) => {
    const enabled = !disabled.includes(c.id);
    const ok = !c.lastError && c.lastCheckedAt !== null;
    const base: ConnectorStatus = {
      state: !c.lastCheckedAt ? "not_connected" : c.lastError ? "error" : "connected",
      detail: !c.lastCheckedAt ? "Not tested yet." : c.lastError ? `Last test failed: ${c.lastError}` : `${c.serverName ?? "Server"} answered tools/list — ${c.tools.length} tool${c.tools.length === 1 ? "" : "s"}${c.protocolVersion ? ` · MCP ${c.protocolVersion}` : ""}`,
      env: [],
      checkedAt: c.lastCheckedAt,
    };
    void ok;
    return {
      key: c.id,
      name: c.name,
      vendor: c.serverName ?? "Custom MCP server",
      category: "custom",
      description: `Custom MCP server at ${safeUrl(c.url)}.`,
      usedBy: ["AI agent (tool discovery)", "Flow Builder — custom nodes"],
      tools: c.tools,
      status: enabled ? base : { ...base, state: "disabled", detail: `Switched off — ${base.detail}` },
      enabled,
      custom: true,
      url: c.url,
    };
  });
  return [...builtIns, ...customs];
}

function safeUrl(u: string) {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`;
  } catch {
    return u;
  }
}

/**
 * What the AI may call right now: tools of connectors that are both
 * configured and switched on. The orchestrator and the action proposer
 * record this so a trace shows what was available, not just what was used.
 */
export async function discoverTools(): Promise<{ connector: string; tool: ConnectorToolInfo }[]> {
  const all = await listConnectors();
  return all.filter((c) => c.enabled && c.status.state === "connected").flatMap((c) => c.tools.map((tool) => ({ connector: c.key, tool })));
}

/** Compact summary for a trace: "sales_engine (22) · google_calendar (2)". */
export async function discoverySummary(): Promise<string[]> {
  const all = await listConnectors();
  return all.filter((c) => c.enabled && c.status.state === "connected").map((c) => `${c.key} (${c.tools.length})`);
}

/** Nodes the Experience Flow Builder can place on a canvas. */
export async function workflowNodes(): Promise<WorkflowNode[]> {
  const found = await discoverTools();
  return found.map(({ connector, tool }) => ({
    id: `${connector}.${tool.name}`,
    connector,
    tool: tool.name,
    label: tool.name.replace(/_/g, " "),
    kind: tool.kind,
    inputs: tool.inputs,
    requiresApproval: tool.kind === "request" || tool.kind === "write",
  }));
}
