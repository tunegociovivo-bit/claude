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
    veteranMustContribute: b.mesaVeteranMustContribute ?? true
  };
}

/** Un cliente es "nuevo" para la red si aún no ha hecho ninguna compra. */
export function isNewCustomer(c: { totalPurchases?: number | null }): boolean {
  return (c.totalPurchases ?? 0) === 0;
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
