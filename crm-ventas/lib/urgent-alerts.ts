import { normalizePhone } from "@/lib/phone";

export function normalizeAlertEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export function normalizeAlertPhone(value: unknown, countryCode = "34") {
  return normalizePhone(String(value ?? ""), countryCode) ?? "";
}

export function shouldSendUrgentAlert(input: {
  lastCode: string | null;
  lastSentAt: Date | null;
  code: string;
  now: Date;
  reminderHours?: number;
}) {
  if (input.lastCode !== input.code || !input.lastSentAt) return true;
  const reminderMs = (input.reminderHours ?? 12) * 60 * 60 * 1000;
  return input.now.getTime() - input.lastSentAt.getTime() >= reminderMs;
}
