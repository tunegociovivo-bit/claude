export type ChallengeServiceMode = "local" | "online";

export function challengeDaysLeft(expiresAt: Date, now = new Date()) {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000));
}

export function challengeSavings(price: number | null | undefined, discountPct: number) {
  if (price == null || !Number.isFinite(price) || price < 0) return null;
  const money = (value: number) => Math.round(value * 100) / 100;
  const savings = money(price * Math.max(0, discountPct) / 100);
  return { price: money(price), savings, finalPrice: money(price - savings) };
}

export function normalizeChallengeService(input: { mode: string; description: string; price?: number | null }) {
  if (input.mode !== "local" && input.mode !== "online") throw new Error("Modo de servicio inválido");
  const description = input.description.trim();
  if (!description) throw new Error("Describe el servicio del reto");
  const price = input.price == null ? null : Number(input.price);
  if (price != null && (!Number.isFinite(price) || price < 0)) throw new Error("Precio inválido");
  return { mode: input.mode as ChallengeServiceMode, description, price };
}

export function nextChallengeFollowup(status: string, from: Date) {
  if (status === "registered") return { status: "awaiting_business", at: new Date(from.getTime() + 86_400_000) };
  if (status === "still_pending") return { status: "followup_pending", at: new Date(from.getTime() + 3 * 86_400_000) };
  return { status: "lost", at: null };
}

export function scheduleChallengeFollowup(
  kind: "first" | "repeat",
  from: Date,
  settings: { firstHours: number; repeatDays: number }
) {
  const amount = kind === "first" ? settings.firstHours * 3_600_000 : settings.repeatDays * 86_400_000;
  return new Date(from.getTime() + amount);
}

export function buildChallengeTimeline(input: {
  registeredAt: Date;
  contactedAt: Date | null;
  decidedAt: Date | null;
  status: string;
  contactChannel: string | null;
}) {
  const channel = input.contactChannel === "whatsapp" ? "WhatsApp" : input.contactChannel === "qr" ? "QR en el local" : "el negocio";
  const result = input.status === "confirmed" ? "Contratado" : ["declined", "lost"].includes(input.status) ? "Descartado" : "Pendiente de resultado";
  return [
    { key: "registered", label: "Alta", at: input.registeredAt.toISOString(), state: "complete" },
    { key: "contacted", label: `Contacto por ${channel}`, at: input.contactedAt?.toISOString() ?? null, state: input.contactedAt ? "complete" : "pending" },
    { key: "result", label: result, at: input.decidedAt?.toISOString() ?? null, state: input.decidedAt ? "complete" : "pending" },
  ];
}

type ConversionRow = { mode: string; registered: boolean; contacted: boolean; confirmed: boolean; declined: boolean };
function summarizeConversion(rows: ConversionRow[]) {
  const registered = rows.filter((row) => row.registered).length;
  const contacted = rows.filter((row) => row.contacted).length;
  const confirmed = rows.filter((row) => row.confirmed).length;
  const declined = rows.filter((row) => row.declined).length;
  return {
    registered, contacted, confirmed, declined,
    contactRate: registered ? Math.round(contacted * 100 / registered) : 0,
    conversionRate: registered ? Math.round(confirmed * 100 / registered) : 0,
  };
}

export function challengeConversionMetrics(rows: ConversionRow[]) {
  return {
    total: summarizeConversion(rows),
    local: summarizeConversion(rows.filter((row) => row.mode === "local")),
    online: summarizeConversion(rows.filter((row) => row.mode === "online")),
  };
}
