export type DownloadStatus = "PENDING" | "RUNNING" | "DOWNLOADED" | "FAILED" | "SKIPPED";

export function getPreviousMonthPeriod(now = new Date(), timezone = "Europe/Madrid") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const currentYear = Number(parts.year);
  const currentMonth = Number(parts.month);
  const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const year = currentMonth === 1 ? currentYear - 1 : currentYear;
  const lastDay = new Date(Date.UTC(year, previousMonth, 0)).getUTCDate();
  const mm = String(previousMonth).padStart(2, "0");
  return { key: `${year}-${mm}`, from: `${year}-${mm}-01`, to: `${year}-${mm}-${lastDay}` };
}

export function shouldRunMonthlySchedule(
  now: Date,
  config: { dayOfMonth: number; time: string; timezone: string },
  lastRunMonth: string | null
) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now).reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const monthKey = `${values.year}-${values.month}`;
  const localTime = `${values.hour}:${values.minute}`;
  return Number(values.day) === config.dayOfMonth && localTime >= config.time && lastRunMonth !== monthKey;
}

export function getRunHealth(items: Array<{ status: string }>): "SUCCESS" | "PARTIAL" | "FAILED" | "PENDING" {
  if (!items.length || items.some((item) => item.status === "PENDING" || item.status === "RUNNING")) return "PENDING";
  const downloaded = items.filter((item) => item.status === "DOWNLOADED").length;
  if (downloaded === items.length) return "SUCCESS";
  return downloaded > 0 ? "PARTIAL" : "FAILED";
}

export function validateRecipients(value: string | string[]) {
  const recipients = (Array.isArray(value) ? value : value.split(/[;,]/))
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(recipients)];
  const invalid = unique.find((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (invalid) throw new Error(`Correo no válido: ${invalid}`);
  if (!unique.length) throw new Error("Añade al menos un correo");
  return unique;
}
