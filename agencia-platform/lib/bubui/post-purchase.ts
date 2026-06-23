/**
 * Push post-compra "gana descuento por una acción".
 *
 * ~1 h después de una compra confirmada, si el negocio tiene activado
 * `postPurchasePushEnabled` y al menos una acción con % > 0, se envía al
 * cliente un push que le ofrece hacer una acción (compartir, reseña, seguir,
 * foto) a cambio de un descuento para su PRÓXIMA visita. El % es DISTINTO por
 * acción. La verificación y la creación del cupón van en
 * /api/bubui/post-purchase/[purchaseId]/action.
 */
import { prisma } from "@/lib/db/prisma";
import { notifyBubuiCustomer } from "./notify";

export type PPActionKey = "share" | "review" | "follow" | "photo";
export type PPAction = { key: PPActionKey; label: string; pct: number };

type BizForActions = {
  shareOfferPct?: number | null;
  reviewRewardPct?: number | null;
  ppFollowDiscountPct?: number | null;
  ppPhotoDiscountPct?: number | null;
  googlePlaceId?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
};

/** Acciones que el negocio ofrece (con % > 0 y el canal necesario disponible). */
export function enabledActions(b: BizForActions): PPAction[] {
  const out: PPAction[] = [];
  if ((b.shareOfferPct ?? 0) > 0) out.push({ key: "share", label: "Comparte Bubui con amigos", pct: b.shareOfferPct! });
  if ((b.reviewRewardPct ?? 0) > 0 && b.googlePlaceId) out.push({ key: "review", label: "Deja una reseña en Google", pct: b.reviewRewardPct! });
  if ((b.ppFollowDiscountPct ?? 0) > 0 && (b.instagramUrl || b.facebookUrl)) out.push({ key: "follow", label: "Síguelos en redes", pct: b.ppFollowDiscountPct! });
  if ((b.ppPhotoDiscountPct ?? 0) > 0) out.push({ key: "photo", label: "Sube una foto o historia", pct: b.ppPhotoDiscountPct! });
  return out;
}

/** % de una acción concreta para un negocio (0 si no aplica). */
export function actionPct(b: BizForActions, key: PPActionKey): number {
  switch (key) {
    case "share": return b.shareOfferPct ?? 0;
    case "review": return (b.reviewRewardPct ?? 0) && b.googlePlaceId ? b.reviewRewardPct ?? 0 : 0;
    case "follow": return (b.ppFollowDiscountPct ?? 0) && (b.instagramUrl || b.facebookUrl) ? b.ppFollowDiscountPct ?? 0 : 0;
    case "photo": return b.ppPhotoDiscountPct ?? 0;
  }
}

const DELAY_MIN = 60; // enviar a partir de 1 h
const WINDOW_MIN = 180; // y hasta 3 h (no avisar de compras más viejas)

/** Cron: envía el push de acciones a las compras que toca. Idempotente vía
 *  actionPushedAt. Devuelve cuántas tocaban y cuántas se enviaron. */
export async function runPostPurchaseActionPush(limit = 200): Promise<{ due: number; sent: number }> {
  const now = Date.now();
  const upper = new Date(now - DELAY_MIN * 60_000);
  const lower = new Date(now - WINDOW_MIN * 60_000);

  const due = await prisma.bubuiPurchase.findMany({
    where: {
      status: "confirmed",
      actionPushedAt: null,
      scannedAt: { gte: lower, lte: upper },
      business: { postPurchasePushEnabled: true, active: true }
    },
    select: {
      id: true,
      customerId: true,
      business: {
        select: {
          id: true, name: true, shareOfferPct: true, reviewRewardPct: true,
          ppFollowDiscountPct: true, ppPhotoDiscountPct: true,
          googlePlaceId: true, instagramUrl: true, facebookUrl: true
        }
      }
    },
    take: limit
  });

  let sent = 0;
  for (const p of due) {
    const actions = enabledActions(p.business);
    if (actions.length === 0) continue; // configurado pero sin acciones: no avisar
    // Marca ANTES de enviar para no duplicar si el cron se solapa.
    const claim = await prisma.bubuiPurchase.updateMany({
      where: { id: p.id, actionPushedAt: null },
      data: { actionPushedAt: new Date() }
    });
    if (claim.count === 0) continue;

    const maxPct = Math.max(...actions.map((a) => a.pct));
    void notifyBubuiCustomer(p.customerId, {
      title: `🎁 Gana descuento en ${p.business.name}`,
      body: `Haz una acción rápida (compartir, reseña, seguir o subir una foto) y llévate hasta un ${maxPct}% en tu próxima visita. 🎉`,
      link: `/bubui/app/ganar/${p.id}`,
      tag: `pp-action:${p.id}`,
      data: { type: "post_purchase_action", purchaseId: p.id, businessId: p.business.id }
    });
    sent++;
  }
  return { due: due.length, sent };
}
