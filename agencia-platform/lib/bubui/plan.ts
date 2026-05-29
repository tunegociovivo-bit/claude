/**
 * Helpers de gating por plan en Bubui.
 *
 * Las funciones "premium" (cohortes, heatmap, cumpleaños automático, pin
 * destacado, slot patrocinado, ruleta) solo están disponibles para negocios
 * con plan Pro o Premium. Free se queda en lo esencial.
 *
 * Reglas de cuota por plan (sponsored slots / mes natural):
 *   pro     → 1 slot / mes
 *   premium → 4 slots / mes
 */

export const PLAN_TIERS = {
  free: 0,
  pro: 1,
  premium: 2
} as const;

export type PlanTier = keyof typeof PLAN_TIERS;

export function isPaidPlan(plan: string | null | undefined): boolean {
  return plan === "pro" || plan === "premium";
}

export function sponsoredQuotaForPlan(plan: string | null | undefined): number {
  if (plan === "premium") return 4;
  if (plan === "pro") return 1;
  return 0;
}
