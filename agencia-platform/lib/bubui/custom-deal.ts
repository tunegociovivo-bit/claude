/**
 * Datos públicos de un RETO personalizado (custom-deal).
 *
 * Fuente única compartida por:
 *   - el endpoint GET /api/bubui/custom-deal/[token] (lo consume la app y la web),
 *   - generateMetadata de /reto/[token] (preview de WhatsApp, SIN JavaScript),
 *   - opengraph-image de /reto/[token] (tarjeta 1200×630).
 *
 * Antes cada sitio consultaba por su cuenta y la página del reto no exponía
 * NINGÚN metadato específico: WhatsApp solo veía el título genérico de Bubui.
 */
import { prisma } from "@/lib/db/prisma";

export type CustomDealPublic = {
  token: string;
  businessName: string;
  city: string | null;
  logoUrl: string | null;
  title: string | null;
  clientDiscountPct: number;
  friendsRequired: number;
  friendDiscountPct: number;
  friendTitle: string | null;
  message: string | null;
  expired: boolean;
  claimed: boolean;
};

/** Devuelve la info pública del reto, o null si el token no existe. */
export async function getCustomDealPublic(token: string): Promise<CustomDealPublic | null> {
  const deal = await prisma.bubuiCustomDeal.findUnique({
    where: { token },
    include: { business: { select: { name: true, city: true, logoUrl: true } } }
  });
  if (!deal) return null;
  return {
    token: deal.token,
    businessName: deal.business?.name ?? "el negocio",
    city: deal.business?.city ?? null,
    logoUrl: deal.business?.logoUrl ?? null,
    title: deal.title,
    clientDiscountPct: deal.clientDiscountPct,
    friendsRequired: deal.friendsRequired,
    friendDiscountPct: deal.friendDiscountPct,
    friendTitle: deal.friendTitle,
    message: deal.message,
    expired: deal.expiresAt.getTime() < Date.now(),
    claimed: !!deal.claimedByCustomerId
  };
}

/**
 * Texto de gancho para el preview del reto (WhatsApp/redes). Se usa tanto en
 * generateMetadata como en la imagen OG para que coincidan.
 */
export function customDealShareCopy(deal: CustomDealPublic | null): { title: string; description: string } {
  if (!deal) {
    return {
      title: "Un negocio te propone un reto en Bubui 🎁",
      description: "Acepta el reto, trae a tus amigos y conseguid descuentos juntos en tu barrio."
    };
  }
  const what = deal.title ? ` en ${deal.title}` : "";
  const friendWhat = deal.friendTitle ? ` en ${deal.friendTitle}` : "";
  const title = `${deal.businessName} te propone un reto: ${deal.clientDiscountPct}%${what} 🎁`;
  const description =
    `Trae a ${deal.friendsRequired} ${deal.friendsRequired === 1 ? "amigo/a" : "amigos/as"} y consigue un ` +
    `${deal.clientDiscountPct}%${what} en ${deal.businessName}${deal.city ? ` (${deal.city})` : ""}. ` +
    `Cada amigo/a se lleva un ${deal.friendDiscountPct}%${friendWhat}.`;
  return { title, description };
}
