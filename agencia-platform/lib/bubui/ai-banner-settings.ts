/**
 * Política de acceso al Banner IA (foto del escaparate → banner con nombre).
 *
 * "all"  → disponible para todos los planes (default).
 * "paid" → solo planes de pago (Pro/Premium); el admin lo cambia desde su
 *          panel cuando quiera, sin deploy.
 *
 * Se guarda en BubuiSetting (mismo patrón que los overrides de secciones).
 */
import { prisma } from "@/lib/db/prisma";

export type AiBannerPolicy = "all" | "paid";

const KEY = "ai_banner_policy";

export async function getAiBannerPolicy(): Promise<AiBannerPolicy> {
  const row = await prisma.bubuiSetting.findUnique({ where: { key: KEY } });
  return row?.value === "paid" ? "paid" : "all";
}

export async function setAiBannerPolicy(policy: AiBannerPolicy): Promise<AiBannerPolicy> {
  await prisma.bubuiSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: policy },
    update: { value: policy }
  });
  return policy;
}

/**
 * Número de banners IA GRATIS por negocio antes de pagar 1€/edición. El admin
 * lo cambia desde su panel (útil para pruebas y para regalar generaciones al
 * principio). Por defecto 1. Se guarda en BubuiSetting.
 */
const FREE_KEY = "ai_banner_free_count";
const FREE_DEFAULT = 1;
const FREE_MAX = 100;

export async function getAiBannerFreeCount(): Promise<number> {
  const row = await prisma.bubuiSetting.findUnique({ where: { key: FREE_KEY } });
  if (!row) return FREE_DEFAULT;
  const n = Number(row.value);
  if (!Number.isFinite(n) || n < 0) return FREE_DEFAULT;
  return Math.min(FREE_MAX, Math.floor(n));
}

export async function setAiBannerFreeCount(count: number): Promise<number> {
  const safe = Number.isFinite(count) && count >= 0 ? Math.min(FREE_MAX, Math.floor(count)) : FREE_DEFAULT;
  await prisma.bubuiSetting.upsert({
    where: { key: FREE_KEY },
    create: { key: FREE_KEY, value: String(safe) },
    update: { value: String(safe) }
  });
  return safe;
}
