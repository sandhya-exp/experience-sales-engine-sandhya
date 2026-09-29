"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { customServers, saveCustomServers, setConnectorEnabled, testCustomServer } from "@/lib/connectors/registry";
import { probeMcpServer } from "@/lib/connectors/mcpClient";
import { settingsAvailable } from "@/lib/repo/settings";

export interface ConnectorActionResult {
  ok: boolean;
  detail: string;
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
