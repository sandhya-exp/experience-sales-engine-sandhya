/**
 * Server-side Anthropic Claude client. Only ever imported from server code
 * (lib/ai, server actions, the eval runner) — the key never reaches the
 * browser; the client only sees the saved brief. One small function — call,
 * parse JSON, fail loudly — so the orchestrator can fall back deterministically.
 */
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5";

/** Overridable for tests/mocks (same convention as the Anthropic SDKs). */
export function claudeBaseUrl() {
  return (process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com").replace(/\/$/, "");
}

export function claudeModel() {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
}

export function claudeAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim()) && process.env.AI_MODE !== "deterministic";
}

export class ClaudeError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ClaudeError";
  }
}

export interface ClaudeJsonResult<T> {
  data: T;
  model: string;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
}

/**
 * Ask Claude for a strict-JSON answer. `system` carries the stage's role and
 * grounding rules; `user` carries the data. The response is parsed and
 * validated by `validate` — anything that fails throws, and the caller falls
 * back to the deterministic result for that stage.
 */
export async function callClaudeJson<T>(args: {
  system: string;
  user: string;
  validate: (raw: unknown) => T;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<ClaudeJsonResult<T>> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new ClaudeError("ANTHROPIC_API_KEY is not set");
  const model = claudeModel();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 25_000);
  const started = Date.now();
  try {
    const res = await fetch(`${claudeBaseUrl()}/v1/messages`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: args.maxTokens ?? 1200,
        temperature: 0,
        system: `${args.system}\n\nRespond with a single JSON object and nothing else — no prose, no markdown fences.`,
        messages: [{ role: "user", content: args.user }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ClaudeError(`Anthropic API ${res.status}: ${body.slice(0, 200)}`, res.status);
    }
    const payload = (await res.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = payload.content?.find((c) => c.type === "text")?.text ?? "";
    const data = args.validate(parseJson(text));
    return {
      data,
      model,
      input_tokens: payload.usage?.input_tokens ?? 0,
      output_tokens: payload.usage?.output_tokens ?? 0,
      duration_ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Tolerates a stray ```json fence or leading text; otherwise strict. */
function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new ClaudeError("Model response was not valid JSON");
  }
}
