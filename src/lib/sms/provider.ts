/**
 * Outbound SMS, on the same boundary as `lib/email/provider.ts` — deliberately
 * the smallest thing that can be honest about what happened.
 *
 * Only a development provider exists today: it records the message on the
 * opportunity and says plainly that nothing left the building, the same
 * distinction email already makes. A live provider (Twilio or similar) plugs
 * in the same way `resendProvider` does for email — swap `smsProvider()`'s
 * body for one more branch — but nobody has asked for that yet, and this app
 * doesn't invent a paid integration nobody configured.
 */
export interface SmsMessage {
  to: string;
  body: string;
}

export type SmsProviderMode = "live" | "development";

export type SmsSendResult =
  | { ok: true; id: string; provider: string; mode: SmsProviderMode; detail: string }
  | { ok: false; provider: string; mode: SmsProviderMode; error: string };

export interface SmsProvider {
  readonly name: string;
  readonly mode: SmsProviderMode;
  send(message: SmsMessage): Promise<SmsSendResult>;
}

function developmentSmsProvider(): SmsProvider {
  return {
    name: "development",
    mode: "development",
    async send(message) {
      const id = `dev_sms_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      return {
        ok: true,
        id,
        provider: this.name,
        mode: this.mode,
        detail: `Recorded for ${message.to}. No SMS was delivered — no SMS provider is configured.`,
      };
    },
  };
}

export function smsProvider(): SmsProvider {
  return developmentSmsProvider();
}
