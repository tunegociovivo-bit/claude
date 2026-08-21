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
