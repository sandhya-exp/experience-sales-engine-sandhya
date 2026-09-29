"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { headers } from "next/headers";
import { customServers, listConnectors, saveCustomServers, setConnectorEnabled, testCustomServer, workflowNodes } from "@/lib/connectors/registry";
import type { ConnectorInfo, WorkflowNode } from "@/lib/connectors/types";
import { probeMcpServer } from "@/lib/connectors/mcpClient";
import { CONNECT_SPECS, clearConnection, getConnection, saveConnection } from "@/lib/connectors/connect";
import { settingsAvailable } from "@/lib/repo/settings";

export interface ConnectorActionResult {
  ok: boolean;
  detail: string;
}

export interface ConnectorsSnapshot {
  connectors: ConnectorInfo[];
  nodes: WorkflowNode[];
  hasSettings: boolean;
  selfUrl: string;
}

/** Everything the MCP Connectors dialog shows, loaded when it opens. */
export async function loadConnectorsAction(): Promise<ConnectorsSnapshot> {
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
  const [connectors, nodes, hasSettings] = await Promise.all([listConnectors(), workflowNodes(), settingsAvailable()]);
  return { connectors, nodes, hasSettings, selfUrl: `${origin}/api/mcp` };
}

export async function setConnectorEnabledAction(key: string, enabled: boolean): Promise<ConnectorActionResult> {
  if (!(await getCurrentUser())) return { ok: false, detail: "Sign in first." };
  const r = await setConnectorEnabled(key, enabled);
  revalidatePath("/connectors");
  return r.ok ? { ok: true, detail: enabled ? "Connector switched on." : "Connector switched off — its tools are hidden from the agent." } : { ok: false, detail: r.detail ?? "Could not save." };
}

/** Probe first; only a server that answers tools/list is saved. */
export async function addCustomServerAction(input: { name: string; url: string; bearerToken?: string | null }): Promise<ConnectorActionResult & { tools?: number }> {
  if (!(await getCurrentUser())) return { ok: false, detail: "Sign in first." };
  const name = input.name.trim();
  const url = input.url.trim();
  if (!name) return { ok: false, detail: "Give the server a name." };
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return { ok: false, detail: "The URL must start with http:// or https://." };
  } catch {
    return { ok: false, detail: "That is not a valid URL." };
  }
  if (!(await settingsAvailable())) return { ok: false, detail: "Custom servers need the app_settings table — run `npm run db:schema` first." };
  const probe = await probeMcpServer(url, input.bearerToken ?? null);
  if (!probe.ok) return { ok: false, detail: `The server did not answer as an MCP server: ${probe.error}` };
  const list = await customServers();
  list.push({
    id: `custom_${randomUUID().slice(0, 8)}`,
    name,
    url,
    bearerToken: input.bearerToken?.trim() || null,
    tools: probe.tools,
    lastCheckedAt: new Date().toISOString(),
    lastError: null,
    serverName: probe.serverName,
    protocolVersion: probe.protocolVersion,
  });
  const saved = await saveCustomServers(list);
  revalidatePath("/connectors");
  return saved.ok ? { ok: true, detail: `${probe.serverName ?? name} connected — ${probe.tools.length} tool${probe.tools.length === 1 ? "" : "s"} in ${probe.latencyMs} ms.`, tools: probe.tools.length } : { ok: false, detail: saved.detail ?? "Could not save." };
}

export async function testCustomServerAction(id: string): Promise<ConnectorActionResult> {
  if (!(await getCurrentUser())) return { ok: false, detail: "Sign in first." };
  const s = await testCustomServer(id);
  revalidatePath("/connectors");
  if (!s) return { ok: false, detail: "That server no longer exists." };
  return s.lastError ? { ok: false, detail: `Failed: ${s.lastError}` } : { ok: true, detail: `${s.serverName ?? s.name} answered — ${s.tools.length} tool${s.tools.length === 1 ? "" : "s"}.` };
}

export async function removeCustomServerAction(id: string): Promise<ConnectorActionResult> {
  if (!(await getCurrentUser())) return { ok: false, detail: "Sign in first." };
  const list = await customServers();
  const r = await saveCustomServers(list.filter((s) => s.id !== id));
  revalidatePath("/connectors");
  return r.ok ? { ok: true, detail: "Server removed." } : { ok: false, detail: r.detail ?? "Could not save." };
}

/** Try a URL before adding it — the "Test connection" button in the dialog. */
export async function probeServerAction(url: string, bearerToken?: string | null): Promise<{ ok: boolean; detail: string; tools: { name: string; description: string }[] }> {
  if (!(await getCurrentUser())) return { ok: false, detail: "Sign in first.", tools: [] };
  const probe = await probeMcpServer(url.trim(), bearerToken ?? null);
  return probe.ok
    ? { ok: true, detail: `${probe.serverName ?? "Server"} answered in ${probe.latencyMs} ms · MCP ${probe.protocolVersion ?? "?"} · ${probe.tools.length} tools`, tools: probe.tools.map((t) => ({ name: t.name, description: t.description })) }
    : { ok: false, detail: probe.error ?? "No answer.", tools: [] };
}

/* ---------------------------------------------------- connect from the app */

/**
 * Connect a built-in connector with credentials entered in the app. The
 * vendor is asked first (a real API call); only a passing check is saved.
 */
export async function connectConnectorAction(key: string, values: Record<string, string>): Promise<ConnectorActionResult & { account?: string | null }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, detail: "Sign in first." };
  const spec = CONNECT_SPECS[key];
  if (!spec) return { ok: false, detail: "This connector is configured through the environment, not from the app." };
  if (!(await settingsAvailable())) return { ok: false, detail: "The app_settings table does not exist yet — run `npm run db:schema`." };
  const clean: Record<string, string> = {};
  for (const f of spec.fields) {
    const v = (values[f.key] ?? "").trim();
    if (!v) return { ok: false, detail: `${f.label} is required.` };
    clean[f.key] = v;
  }
  let result;
  try {
    result = await spec.verify(clean);
  } catch (e) {
    return { ok: false, detail: `Could not reach the vendor: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!result.ok) return { ok: false, detail: result.error ?? "The vendor rejected these credentials." };
  const saved = await saveConnection(key, { values: clean, account: result.account, verifiedAt: new Date().toISOString() });
  if (!saved.ok) return { ok: false, detail: saved.detail ?? "Could not save." };
  revalidatePath("/connectors");
  return { ok: true, detail: `Connected as ${result.account ?? "verified account"}.`, account: result.account };
}

/** Ask the vendor again with the saved credentials; updates the verified time or reports what broke. */
export async function verifyConnectorAction(key: string): Promise<ConnectorActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, detail: "Sign in first." };
  const spec = CONNECT_SPECS[key];
  const saved = await getConnection(key);
  if (!spec || !saved) return { ok: false, detail: "Nothing saved for this connector — it is configured through the environment." };
  try {
    const r = await spec.verify(saved.values);
    if (!r.ok) return { ok: false, detail: r.error ?? "The vendor rejected the saved credentials." };
    await saveConnection(key, { ...saved, account: r.account, verifiedAt: new Date().toISOString() });
    revalidatePath("/connectors");
    return { ok: true, detail: `Still connected as ${r.account ?? "verified account"}.` };
  } catch (e) {
    return { ok: false, detail: `Could not reach the vendor: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Forget credentials saved from the app. Environment variables are untouched. */
export async function disconnectConnectorAction(key: string): Promise<ConnectorActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, detail: "Sign in first." };
  const r = await clearConnection(key);
  if (!r.ok) return { ok: false, detail: r.detail ?? "Could not disconnect." };
  revalidatePath("/connectors");
  return { ok: true, detail: "Disconnected — saved credentials removed." };
}
