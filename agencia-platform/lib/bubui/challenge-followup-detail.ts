export type ChallengeFollowupDetailInput = { originalPrice?: number | null; discountPct?: number | null };

const money = (value: number) => Math.round(value * 100) / 100;

export function buildChallengeFollowupDetail(input: ChallengeFollowupDetailInput) {
  const discountPct = Math.max(0, Math.min(100, input.discountPct ?? 0));
  const originalPrice = input.originalPrice == null ? null : money(input.originalPrice);
  if (originalPrice == null) return { originalPrice, discountPct, savings: null, finalPrice: null };
  const savings = money(originalPrice * discountPct / 100);
  return { originalPrice, discountPct, savings, finalPrice: money(originalPrice - savings) };
}
