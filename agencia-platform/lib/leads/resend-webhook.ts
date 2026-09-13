import { createHmac, timingSafeEqual } from "node:crypto";

function signatures(value: string): Buffer[] {
  return value.split(/\s+/).flatMap((part) => {
    const encoded = part.includes(",") ? part.split(",")[1] : part;
    try { return encoded ? [Buffer.from(encoded, "base64")] : []; } catch { return []; }
  });
}

export function verifyResendWebhook(opts: {
  rawBody: string;
  id: string;
  timestamp: string;
  signature: string;
  secret: string;
  toleranceSeconds?: number;
}): boolean {
  const timestamp = Number(opts.timestamp);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > (opts.toleranceSeconds ?? 300)) return false;
  const rawSecret = opts.secret.startsWith("whsec_") ? opts.secret.slice(6) : opts.secret;
  let key: Buffer;
  try { key = Buffer.from(rawSecret, "base64"); } catch { return false; }
  const expected = createHmac("sha256", key).update(`${opts.id}.${opts.timestamp}.${opts.rawBody}`).digest();
  return signatures(opts.signature).some((actual) => actual.length === expected.length && timingSafeEqual(actual, expected));
}

function emailHeader(headers: unknown, name: string): string {
  if (!headers) return "";
  if (Array.isArray(headers)) {
    const entry = headers.find((item: any) => String(item?.name ?? item?.key ?? "").toLowerCase() === name.toLowerCase()) as any;
    return String(entry?.value ?? "");
  }
  if (typeof headers !== "object") return "";
  const entry = Object.entries(headers as Record<string, unknown>)
    .find(([key]) => key.toLowerCase() === name.toLowerCase());
  return String(entry?.[1] ?? "");
}

export function isAutomaticEmailReply(opts: { subject?: string; text?: string; headers?: unknown }): boolean {
  const autoSubmitted = emailHeader(opts.headers, "auto-submitted").trim().split(";", 1)[0].toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (emailHeader(opts.headers, "x-autoreply") || emailHeader(opts.headers, "x-autorespond")) return true;
  if (/^(?:auto_reply|bulk|junk|list)$/i.test(emailHeader(opts.headers, "precedence").trim())) return true;

  const content = `${opts.subject ?? ""}\n${opts.text ?? ""}`;
  return /auto.?repl(?:y|ied)|automatic reply|respuesta autom[aá]tica|fuera de (?:la )?oficina|out of office|vacaciones|mailer-daemon|undeliverable/i.test(content);
}

export type ResendFailureKind = "invalid_recipient" | "quota" | "configuration" | "transient";

export function classifyResendFailure(reason: string, status?: number | null): ResendFailureKind {
  const text = reason.toLowerCase();
  if (/reached_daily_quota|daily.?quota|rate.?limit|too many requests|quota exceeded/.test(text) || status === 429) return "quota";
  if (/invalid.?recipient|recipient[^\n]{0,40}invalid|invalid[^\n]{0,40}(?:recipient|`?to`?\s+field|email address)|(?:recipient|`?to`?\s+field)[^\n]{0,40}(?:not valid|validation)/.test(text)) return "invalid_recipient";
  if (/api.?key|from.?address|sender|domain|verif|authentication|unauthor|forbidden|permission|not allowed/.test(text)) return "configuration";
  if (status === 400 || status === 401 || status === 403 || status === 422) return "configuration";
  return "transient";
}

export function resendFailureRetryAt(reason: string, now = new Date()): Date {
  if (/reached_daily_quota|daily.?quota/i.test(reason)) {
    const next = new Date(now);
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(0, 5, 0, 0);
    return next;
  }
  return new Date(now.getTime() + 60 * 60_000);
}
