/**
 * MCP connectors — the shape shared by the registry, the page and the agent.
 * Client-safe: no secrets, no providers, just descriptions and status.
 */
export type ConnectorCategory = "internal" | "email" | "calendar" | "messaging" | "crm" | "custom";
export type ConnectorState = "connected" | "not_connected" | "demo" | "error" | "disabled";
export type ToolKind = "read" | "compute" | "draft" | "request" | "write";

export interface ConnectorToolInfo {
  name: string;
  description: string;
  kind: ToolKind;
  /** Top-level input parameter names, for the tool list and for workflow nodes. */
  inputs: string[];
}

export interface ConnectorStatus {
  state: ConnectorState;
  /** One line a person can act on: what is connected, or what is missing. */
  detail: string;
  /** Environment variables the connector needs and whether each is present. */
  env: { key: string; present: boolean }[];
  /** For custom servers: when it was last reached. */
  checkedAt?: string | null;
}

export interface ConnectorInfo {
  key: string;
  name: string;
  vendor: string;
  category: ConnectorCategory;
  description: string;
  /** Sales Engine features that call this connector's tools. */
  usedBy: string[];
  tools: ConnectorToolInfo[];
  status: ConnectorStatus;
  /** The person switched it off; tools are hidden from the agent even if configured. */
  enabled: boolean;
  /** Built in, or added on the Connectors page. */
  custom: boolean;
  /** Custom servers: where it lives (token never included). */
  url?: string;
  docsUrl?: string;
  /** Built-ins that can be connected from inside the app: what to ask for. Values are never included. */
  connect?: ConnectSpec;
  /** Where the credentials come from once connected, and what the vendor said we are connected as. */
  connection?: ConnectionInfo;
}

export interface ConnectField {
  /** Same name as the environment variable the connector also accepts. */
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
}

export interface ConnectSpec {
  intro: string;
  capabilities: string[];
  fields: ConnectField[];
  help?: string;
  docsUrl?: string;
}

export interface ConnectionInfo {
  source: "env" | "saved";
  account: string | null;
  verifiedAt: string | null;
}

/** A tool as a workflow node the Flow Builder can place: what it needs and what it yields. */
export interface WorkflowNode {
  id: string; // `${connector}.${tool}`
  connector: string;
  tool: string;
  label: string;
  kind: ToolKind;
  inputs: string[];
  /** Whether the node can run without a person approving (read/compute) or needs a confirmation gate. */
  requiresApproval: boolean;
}

export interface CustomServer {
  id: string;
  name: string;
  url: string;
  /** Stored so the server can be re-tested; never sent to the browser. */
  bearerToken?: string | null;
  tools: ConnectorToolInfo[];
  lastCheckedAt: string | null;
  lastError: string | null;
  serverName?: string | null;
  protocolVersion?: string | null;
}
