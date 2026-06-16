/**
 * Ajustes GLOBALES de crecimiento de Bubui (clave-valor en BubuiSetting),
 * configurables desde el panel de administrador:
 *
 *  - challenge_alt_min_referrals: nº de amigos dados de alta a partir del cual un
 *    usuario desbloquea la activación ALTERNATIVA de los cupones-reto (reseña/
 *    foto), en vez de depender solo de los amigos. Por defecto 10.
 *  - challenge_expiry_warn_days: días antes de caducar un cupón-reto en los que
 *    se envía el push recordatorio. Por defecto 3.
 */
import { prisma } from "@/lib/db/prisma";

const ALT_MIN_KEY = "challenge_alt_min_referrals";
const EXPIRY_WARN_KEY = "challenge_expiry_warn_days";

export const DEFAULT_ALT_MIN_REFERRALS = 10;
export const DEFAULT_EXPIRY_WARN_DAYS = 3;

export async function getAltActionMinReferrals(): Promise<number> {
  const row = await prisma.bubuiSetting.findUnique({ where: { key: ALT_MIN_KEY } });
  if (!row) return DEFAULT_ALT_MIN_REFERRALS;
  const n = Number(row.value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_ALT_MIN_REFERRALS;
}

export async function setAltActionMinReferrals(n: number): Promise<number> {
  const safe = Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_ALT_MIN_REFERRALS;
  await prisma.bubuiSetting.upsert({
    where: { key: ALT_MIN_KEY },
    create: { key: ALT_MIN_KEY, value: String(safe) },
    update: { value: String(safe) }
  });
  return safe;
}

export async function getChallengeExpiryWarnDays(): Promise<number> {
  const row = await prisma.bubuiSetting.findUnique({ where: { key: EXPIRY_WARN_KEY } });
  if (!row) return DEFAULT_EXPIRY_WARN_DAYS;
  const n = Number(row.value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_EXPIRY_WARN_DAYS;
}

export async function setChallengeExpiryWarnDays(n: number): Promise<number> {
  const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_EXPIRY_WARN_DAYS;
  await prisma.bubuiSetting.upsert({
    where: { key: EXPIRY_WARN_KEY },
    create: { key: EXPIRY_WARN_KEY, value: String(safe) },
    update: { value: String(safe) }
  });
  return safe;
}
