/**
 * Outbound email, behind one boundary.
 *
 * The Sales Engine had no way to send anything before the agent needed one, so
 * this is deliberately the smallest thing that can be honest about what
 * happened. Two implementations:
 *
 *   live        — a real provider configured through the environment. A message
 *                 reaches the customer, and only this path may report "sent".
 *   development — the default. It records the message on the opportunity and
 *                 says so. It never claims delivery, and the UI labels it.
 *
 * The distinction is the whole point: `mode` travels with every result, the
 * delivery state derived from it is "sent" only for a live provider that
 * confirmed, and a development send is stored as "recorded". Nothing in the
 * product ever shows a customer a message that wasn't sent while telling the
 * salesperson it was.
 *
 * Server-side only — the keys never reach the browser.
 */
export interface EmailAddress {
  name: string | null;
  email: string;
}

export interface EmailMessage {
  to: EmailAddress;
  subject: string;
  /** Plain text. The agent writes plain text; there is no template layer to go wrong. */
  body: string;
  replyTo?: string | null;
}

export type SendResult =
  | { ok: true; id: string; provider: string; mode: EmailProviderMode; detail: string }
  | { ok: false; provider: string; mode: EmailProviderMode; error: string };

export type EmailProviderMode = "live" | "development";

export interface ProviderValidation {
  ok: boolean;
  /** What is configured, or exactly which variable is missing. */
  detail: string;
}

export interface EmailProvider {
  readonly name: string;
  readonly mode: EmailProviderMode;
  validate(): ProviderValidation;
  send(message: EmailMessage): Promise<SendResult>;
}

/* ------------------------------------------------------------------ live */

/**
 * Resend over plain HTTPS — no SDK, same approach as the Google Calendar
 * integration. Enabled by EMAIL_PROVIDER=resend with RESEND_API_KEY and
 * EMAIL_FROM set.
 */
function resendProvider(): EmailProvider {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  return {
    name: "resend",
    mode: "live",
    validate() {
      if (!key) return { ok: false, detail: "RESEND_API_KEY is not set." };
      if (!from) return { ok: false, detail: "EMAIL_FROM is not set (e.g. \"Experience.com Sales <sales@yourdomain.com>\")." };
      return { ok: true, detail: `Resend, sending as ${from}.` };
    },
    async send(message) {
      const v = this.validate();
      if (!v.ok) return { ok: false, provider: this.name, mode: this.mode, error: v.detail };
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({
            from,
            to: [message.to.email],
            subject: message.subject,
            text: message.body,
            ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
        if (!res.ok) return { ok: false, provider: this.name, mode: this.mode, error: `Resend ${res.status}: ${payload.message ?? payload.name ?? "send failed"}` };
        if (!payload.id) return { ok: false, provider: this.name, mode: this.mode, error: "Resend accepted the request but returned no message id." };
        return { ok: true, id: payload.id, provider: this.name, mode: this.mode, detail: `Delivered to ${message.to.email} by Resend.` };
      } catch (err) {
        return { ok: false, provider: this.name, mode: this.mode, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/* ----------------------------------------------------------- development */

/**
 * The default. Produces a real, stable id so the action can be traced, and a
 * detail line that says plainly that nothing left the building.
 */
function developmentProvider(): EmailProvider {
  return {
    name: "development",
    mode: "development",
    validate() {
      return { ok: true, detail: "Development provider — messages are recorded on the opportunity, not delivered to the customer." };
    },
    async send(message) {
      const id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      return {
        ok: true,
        id,
        provider: this.name,
        mode: this.mode,
        detail: `Recorded for ${message.to.email}. No email was delivered — set EMAIL_PROVIDER=resend with RESEND_API_KEY and EMAIL_FROM to send for real.`,
      };
    },
  };
}

/** Which provider this deployment is configured for. */
export function emailProvider(): EmailProvider {
  const configured = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (configured === "resend") {
    const p = resendProvider();
    // A misconfigured live provider must not silently become a development one:
    // it stays live and fails loudly, so nobody believes a message was sent.
    return p;
  }
  return developmentProvider();
}

/* -------------------------------------------------------- delivery state */

/**
 * What the salesperson is told.
 *
 *   drafted   the agent wrote it; nobody has approved it
 *   approved  a person approved it; the send has not completed
 *   sent      a LIVE provider confirmed delivery
 *   recorded  the development provider stored it; it was not delivered
 *   failed    the provider refused it, with the reason
 */
export type DeliveryState = "drafted" | "approved" | "sent" | "recorded" | "failed";

export interface Delivery {
  state: DeliveryState;
  provider: string;
  mode: EmailProviderMode | null;
  message_id: string | null;
  detail: string;
  at: string;
}

export function deliveryFrom(result: SendResult): Delivery {
  const at = new Date().toISOString();
  if (!result.ok) {
    return { state: "failed", provider: result.provider, mode: result.mode, message_id: null, detail: result.error, at };
  }
  return {
    // "sent" is reserved for a live provider that confirmed. Anything else is "recorded".
    state: result.mode === "live" ? "sent" : "recorded",
    provider: result.provider,
    mode: result.mode,
    message_id: result.id,
    detail: result.detail,
    at,
  };
}

export const DELIVERY_LABEL: Record<DeliveryState, string> = {
  drafted: "Drafted",
  approved: "Approved",
  sent: "Sent",
  recorded: "Recorded — not delivered",
  failed: "Failed",
};
