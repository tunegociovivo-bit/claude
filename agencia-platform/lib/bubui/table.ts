/**
 * Lógica compartida de la Mesa Colectiva (Fase 2): construir la config desde el
 * negocio, clasificar nuevo/veterano, cargar el estado de una sesión y aplicar
 * el cierre (descuento de esta visita + cupón de próxima visita).
 */
import { prisma } from "@/lib/db/prisma";
import { computeMesa, effectiveVeteranShareFriends, type MesaConfig, type MesaParticipant } from "./table-deal";

/** MesaConfig efectiva del negocio (los nº numéricos pueden venir del snapshot). */
export function mesaConfigFromBusiness(b: any, snapshot?: { shareFriends?: number }): MesaConfig {
  return {
    basePct: b.mesaBasePct ?? 20,
    minDiners: b.mesaMinDiners ?? 4,
    shareBonusPct: b.mesaShareBonusPct ?? 5,
    shareFriends: snapshot?.shareFriends ?? b.mesaVeteranShareFriends ?? b.mesaShareFriends ?? 1,
    reviewBonusPct: b.mesaReviewBonusPct ?? 5,
    maxPct: b.mesaMaxPct ?? 35,
    bonusOnThisVisit: !!b.mesaBonusOnThisVisit,
    veteranMustContribute: b.mesaVeteranMustContribute ?? true,
    newUserMustContribute: b.mesaNewUserMustContribute ?? false,
    reviewPlatformLabel: mesaReviewPlatformLabel(b)
  };
}

/** Un cliente es "nuevo" para la red si aún no ha hecho ninguna compra. */
export function isNewCustomer(c: { totalPurchases?: number | null }): boolean {
  return (c.totalPurchases ?? 0) === 0;
}

/** Enlace de reseña según la plataforma elegida por el negocio (mesaReviewPlatform). */
export function mesaReviewUrl(b: any): string | null {
  const platform = b.mesaReviewPlatform || "google";
  switch (platform) {
    case "tripadvisor":
      return b.tripadvisorUrl || null;
    case "trustpilot":
      return b.trustpilotUrl || null;
    case "instagram":
      return b.instagramUrl || null;
    case "google":
    default:
      return b.googlePlaceId ? `https://search.google.com/local/writereview?placeid=${b.googlePlaceId}` : null;
  }
}

/** Nombre legible de la plataforma de reseña. */
export function mesaReviewPlatformLabel(b: any): string {
  switch (b.mesaReviewPlatform || "google") {
    case "tripadvisor": return "Tripadvisor";
    case "trustpilot": return "Trustpilot";
    case "instagram": return "Instagram";
    default: return "Google";
  }
}

/** Acciones de aporte que el comercio acepta del veterano. */
export function allowedContributions(b: any): string[] {
  const out: string[] = [];
  if (b.mesaActShare) out.push("share");
  if (b.mesaActReview) out.push("review");
  if (b.mesaActPhoto) out.push("photo");
  if (b.mesaActFollow) out.push("follow");
  return out.length ? out : ["share"];
}

/** Carga la sesión + participantes + negocio y devuelve el estado calculado. */
export async function loadTableState(sessionId: string, ticketAmount?: number | null) {
  const session = await prisma.bubuiTableSession.findUnique({
    where: { id: sessionId },
    include: { participants: true, business: true }
  });
  if (!session) return null;
  const cfg = mesaConfigFromBusiness(session.business, { shareFriends: session.shareFriends });
  const parts: MesaParticipant[] = session.participants.map((p) => ({
    isNewUser: p.isNewUser,
    reviewVerified: p.reviewVerified,
    socialVerified: p.socialVerified,
    reviewProvisional: p.reviewProvisional,
    socialProvisional: p.socialProvisional,
    contributed: p.contributed,
    sharedCount: p.sharedCount,
    sharedDone: p.sharedDone,
    reviewDone: p.reviewDone
  }));
  const state = computeMesa(cfg, parts, ticketAmount ?? null);
  return { session, cfg, state };
}

/** Umbral de amigos del veterano ajustado por la saturación de la mesa. */
export function veteranShareFor(business: any, veteranRatio: number): number {
  const base = business.mesaVeteranShareFriends ?? 1;
  return business.mesaAutoAdjust ? effectiveVeteranShareFriends(base, veteranRatio) : base;
}

/**
 * Cierra la mesa con el importe del ticket (lo escanea quien paga): fija el % de
 * esta visita, guarda el importe, crea el cupón de próxima visita a cada comensal
 * y marca la sesión como canjeada. Idempotente: si ya estaba cerrada devuelve lo
 * guardado. Es el "cierre" del flujo en el que el camarero aplica el descuento al
 * ver la pantalla del comensal.
 */
export async function finalizeMesaBill(sessionId: string, ticketAmount: number, billedById: string | null) {
  const loaded = await loadTableState(sessionId, ticketAmount);
  if (!loaded) return null;
  const { session, state } = loaded;
  const business = session.business;

  if (session.status === "redeemed") {
    // Ya cerrada: recalcula con el importe ya guardado para mostrar la cuenta.
    const re = await loadTableState(sessionId, session.ticketAmount ?? ticketAmount);
    return { session, state: re?.state ?? state, appliedPct: session.finalPct ?? state.pctNow, alreadyDone: true, perkEarned: null as string | null };
  }

  const appliedPct = state.pctNow;
  const nextVisitPct = state.pctNextVisit;
  const days = business.mesaNextVisitDays ?? 15;
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  const perk = (business.mesaPerkLabel || "").trim();
  const perkEarned = !!perk && state.unlocked;

  if (nextVisitPct > 0 || perkEarned) {
    const parts = await prisma.bubuiTableParticipant.findMany({ where: { sessionId }, select: { customerId: true } });
    for (const p of parts) {
      await prisma.bubuiOffer
        .upsert({
          where: { customerId_businessId_triggerBusinessId: { customerId: p.customerId, businessId: business.id, triggerBusinessId: `mesa:${sessionId}` } },
          create: { customerId: p.customerId, businessId: business.id, triggerBusinessId: `mesa:${sessionId}`, discountPct: nextVisitPct, rewardLabel: perkEarned ? perk : null, source: "mesa", active: true, expiresAt },
          update: { discountPct: nextVisitPct, rewardLabel: perkEarned ? perk : null, expiresAt, active: true }
        })
        .catch(() => {});
    }
  }

  await prisma.bubuiTableSession.update({
    where: { id: sessionId },
    data: { status: "redeemed", finalPct: appliedPct, ticketAmount, billedById, verifiedAt: new Date(), redeemedAt: new Date() }
  });

  return { session, state, appliedPct, nextVisitPct, perkEarned: perkEarned ? perk : null, expiresAt, alreadyDone: false };
}
