/**
 * Lib core de Bipi — utilidades compartidas:
 *  - Generación de slug único por negocio.
 *  - URL del QR (que el cliente escanea con la app).
 *  - Generación del PDF/PNG del cartel con QR + branding.
 *  - Geo helpers para anti-fraude + búsqueda por radio.
 *  - Scoring de visibilidad (karma).
 *  - Generación de ofertas tras compra confirmada.
 */

import { prisma } from "@/lib/db/prisma";
import QRCode from "qrcode";

/** URL pública que codifica el QR del negocio. */
export function bipiScanUrl(businessId: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/bipi/scan/${businessId}`;
}

/** Genera un slug humano único a partir del nombre del negocio. */
export async function uniqueBusinessSlug(name: string): Promise<string> {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  let slug = base || "negocio";
  let n = 1;
  while (await prisma.bipiBusiness.findUnique({ where: { slug } })) {
    n++;
    slug = `${base}-${n}`;
  }
  return slug;
}

/** Devuelve el QR del negocio como PNG buffer (para imprimir o usar en el
 *  cartel). El QR codifica la URL de scan, que la app abre al escanear. */
export async function generateBusinessQrPng(opts: {
  businessId: string;
  baseUrl: string;
  size?: number; // px
}): Promise<Buffer> {
  const url = bipiScanUrl(opts.businessId, opts.baseUrl);
  return QRCode.toBuffer(url, {
    type: "png",
    width: opts.size ?? 800,
    margin: 2,
    errorCorrectionLevel: "H"
  });
}

/** Distancia en metros entre dos coordenadas (haversine simplificada). */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Tras una compra confirmada genera el set de ofertas que se desbloquean
 *  para el cliente. Lógica v1:
 *   - 3-5 negocios complementarios cercanos (<3 km).
 *   - Excluye el propio negocio.
 *   - Prioriza por visibilityScore (karma).
 *   - Cada oferta caduca a las 96h.
 */
export async function unlockOffersForPurchase(opts: {
  customerId: string;
  triggerBusinessId: string;
  triggerCategory: string;
  triggerLat?: number | null;
  triggerLng?: number | null;
}): Promise<{ created: number }> {
  const allNearby = await prisma.bipiBusiness.findMany({
    where: {
      id: { not: opts.triggerBusinessId },
      active: true,
      visibilityScore: { gte: 20 }
    },
    orderBy: { visibilityScore: "desc" },
    take: 50
  });

  // Filtro por categoría complementaria (no la misma — no tiene sentido
  // ofrecer descuento en otro spa cuando acabas de gastar en un spa).
  const filtered = allNearby.filter((b) => b.category !== opts.triggerCategory);

  // Si tenemos coords, ordenamos por cercanía y nos quedamos con los
  // de <3km. Si no, mantenemos orden por karma.
  let candidates = filtered;
  if (opts.triggerLat != null && opts.triggerLng != null) {
    candidates = filtered
      .map((b) => ({
        b,
        dist:
          b.latitude != null && b.longitude != null
            ? haversineMeters(opts.triggerLat!, opts.triggerLng!, b.latitude, b.longitude)
            : Infinity
      }))
      .filter((x) => x.dist < 3000)
      .sort((a, b) => a.dist - b.dist)
      .map((x) => x.b);
  }

  const targets = candidates.slice(0, 5);
  const expiresAt = new Date(Date.now() + 96 * 60 * 60 * 1000);

  let created = 0;
  for (const b of targets) {
    try {
      await prisma.bipiOffer.create({
        data: {
          customerId: opts.customerId,
          businessId: b.id,
          triggerBusinessId: opts.triggerBusinessId,
          discountPct: b.crossDiscountPct,
          expiresAt
        }
      });
      created++;
    } catch {
      // unique violation (customer+business+trigger ya existe) → ignoramos.
    }
  }
  return { created };
}

/** Karma de visibilidad — recalcula el score para un negocio.
 *  Llamado nocturno desde cron o al evento "purchase confirmed". */
export async function recalculateVisibilityScore(businessId: string): Promise<number> {
  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 86_400_000);
  const d30 = new Date(now.getTime() - 30 * 86_400_000);

  const [scans7, scans30, redeemedFromOthers, business] = await Promise.all([
    prisma.bipiPurchase.count({
      where: { businessId, status: "confirmed", scannedAt: { gte: d7 } }
    }),
    prisma.bipiPurchase.count({
      where: { businessId, status: "confirmed", scannedAt: { gte: d30 } }
    }),
    prisma.bipiOffer.count({
      where: { businessId, redeemed: true, redeemedAt: { gte: d30 } }
    }),
    prisma.bipiBusiness.findUnique({
      where: { id: businessId },
      select: { createdAt: true }
    })
  ]);

  // Pesos: escaneos 7d (max 60), escaneos 30d (max 20), redeemed (max 15),
  // antigüedad (max 5).
  const score7 = Math.min(60, scans7 * 6); // 10 escaneos/sem = 60.
  const score30 = Math.min(20, scans30);
  const scoreRedeem = Math.min(15, redeemedFromOthers * 3);
  const ageDays = business
    ? Math.floor((now.getTime() - business.createdAt.getTime()) / 86_400_000)
    : 0;
  const scoreAge = Math.min(5, Math.floor(ageDays / 30));

  const score = score7 + score30 + scoreRedeem + scoreAge;
  await prisma.bipiBusiness.update({
    where: { id: businessId },
    data: { visibilityScore: score, scoreUpdatedAt: now }
  });
  return score;
}

/** Recalcula el nivel embajador del cliente en función de variedad y
 *  volumen de compras. Niveles:
 *    none    →  default
 *    bronze  →  5+ compras en 2+ negocios distintos
 *    silver  →  15+ compras en 5+ negocios distintos
 *    gold    →  40+ compras en 10+ negocios distintos
 *    founder →  100+ compras en 20+ negocios distintos
 */
export async function recalculateAmbassadorLevel(customerId: string): Promise<string> {
  const purchases = await prisma.bipiPurchase.findMany({
    where: { customerId, status: "confirmed" },
    select: { businessId: true }
  });
  const total = purchases.length;
  const distinct = new Set(purchases.map((p) => p.businessId)).size;
  let level = "none";
  if (total >= 100 && distinct >= 20) level = "founder";
  else if (total >= 40 && distinct >= 10) level = "gold";
  else if (total >= 15 && distinct >= 5) level = "silver";
  else if (total >= 5 && distinct >= 2) level = "bronze";
  await prisma.bipiCustomer.update({
    where: { id: customerId },
    data: { ambassadorLevel: level }
  });
  return level;
}

/** Pricing dinámico de un push según radio + ciudad + densidad estimada.
 *  v1: aproximación por radio y por densidad de la zona (Benalmádena vs
 *  Madrid). En producción esto consulta la base de usuarios activos. */
export function dynamicPushPriceEur(opts: {
  radiusKm: number;
  city: string;
}): { reach: number; priceEur: number } {
  // Densidad muy aproximada de usuarios Bipi/km² por ciudad.
  const DENSITY: Record<string, number> = {
    Benalmádena: 80,
    Málaga: 250,
    Marbella: 120,
    Barcelona: 600,
    Madrid: 800
  };
  const density = DENSITY[opts.city] ?? 60;
  const reach = Math.round(Math.PI * opts.radiusKm ** 2 * density);
  // 0.005 €/usuario alcanzado, mínimo 5€.
  const priceEur = Math.max(5, Math.round(reach * 0.005));
  return { reach, priceEur };
}
