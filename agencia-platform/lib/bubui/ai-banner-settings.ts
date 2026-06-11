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
