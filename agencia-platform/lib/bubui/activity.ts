/**
 * Historial de actividad de un cliente Bubui (panel admin).
 *
 * La mayoría de acciones ya quedan guardadas en su propia tabla (compras,
 * tickets, cupones, retos, reseñas, mesas, citas, notificaciones…), así que el
 * historial se DEDUCE de ellas: funciona también hacia atrás, para toda la
 * actividad anterior a esta función. Lo que no deja rastro en ninguna tabla
 * (compartir una oferta o el enlace de invitación, iniciar sesión) se registra
 * en BubuiActivityEvent con logBubuiActivity().
 *
 * Paginación: cada fuente se consulta por separado, ordenada por SU fecha y
 * con `take = limit + 1`, y luego se mezcla. Así el top-N de la mezcla es
 * exacto aunque una misma fila genere varios eventos (escaneo + confirmación,
 * cupón recibido + canjeado).
 */

import { prisma } from "@/lib/db/prisma";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export const ACTIVITY_KINDS = [
  "account",
  "scan",
  "purchase",
  "coupon",
  "share",
  "friends",
  "review",
  "table",
  "booking",
  "push"
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** Eventos que la app/PWA puede registrar (POST /api/bubui/activity). */
export const CLIENT_SHARE_TYPES = [
  "offer_shared",
  "referral_shared",
  "business_shared",
  "challenge_link_shared",
  "challenge_reminder_shared"
] as const;
export type ClientShareType = (typeof CLIENT_SHARE_TYPES)[number];

/** Eventos que solo registra el servidor. */
export const SERVER_EVENT_TYPES = ["login"] as const;

export const SHARE_CHANNELS = ["whatsapp", "share_sheet", "copy"] as const;

export type ActivityTone = "ok" | "pending" | "bad" | "neutral";

export type ActivityItem = {
  id: string;
  at: string; // ISO
  kind: ActivityKind;
  type: string;
  title: string;
  detail: string | null;
  businessId: string | null;
  businessName: string | null;
  amount: number | null;
  status: string | null;
  tone: ActivityTone;
};

// Evento "en bruto" de cada fuente, antes de ponerle texto.
export type RawActivity =
  | { type: "signup"; id: string; at: Date; referredByName: string | null; businessId: string | null }
  | { type: "login"; id: string; at: Date; platform: string | null; appBuild: string | null }
  | {
      type: "purchase_scanned";
      id: string;
      at: Date;
      businessId: string;
      amount: number;
      discountPct: number;
      discountAmount: number;
      status: string;
      rejectionReason: string | null;
      usedCoupon: boolean;
      walletPctUsed: number;
      scanDistanceM: number | null;
    }
  | { type: "purchase_confirmed"; id: string; at: Date; businessId: string; amount: number; discountAmount: number }
  | { type: "ticket_scanned"; id: string; at: Date; businessId: string | null; amount: number | null; used: boolean }
  | {
      type: "offer_unlocked";
      id: string;
      at: Date;
      businessId: string;
      discountPct: number;
      rewardLabel: string | null;
      source: string | null;
      unlockShares: number;
      active: boolean;
      expiresAt: Date;
    }
  | { type: "offer_redeemed"; id: string; at: Date; businessId: string; discountPct: number; rewardLabel: string | null; source: string | null }
  | {
      type: "custom_deal_claimed";
      id: string;
      at: Date;
      businessId: string;
      clientDiscountPct: number;
      friendsRequired: number;
      title: string | null;
    }
  | { type: "share"; id: string; at: Date; shareType: string; businessId: string | null; channel: string | null; platform: string | null }
  | { type: "referral_link_opened"; id: string; at: Date; businessId: string | null; platform: string | null }
  | { type: "friend_signup"; id: string; at: Date; friendName: string | null; phoneVerified: boolean }
  | { type: "challenge_friend_decided"; id: string; at: Date; businessId: string; friendName: string | null; status: string }
  | { type: "joined_challenge"; id: string; at: Date; businessId: string; referrerName: string | null }
  | { type: "challenge_contact"; id: string; at: Date; businessId: string; channel: string | null }
  | { type: "review"; id: string; at: Date; businessId: string; rating: number; comment: string | null }
  | { type: "google_review"; id: string; at: Date; businessId: string }
  | { type: "social_follow"; id: string; at: Date; businessId: string }
  | { type: "table_created"; id: string; at: Date; businessId: string; tableLabel: string | null; status: string; finalPct: number | null }
  | { type: "table_joined"; id: string; at: Date; businessId: string; isNewUser: boolean }
  | { type: "table_contributed"; id: string; at: Date; businessId: string; contributionType: string | null }
  | { type: "booking"; id: string; at: Date; businessId: string; startsAt: Date; status: string; serviceName: string | null }
  | { type: "push"; id: string; at: Date; kind: string; title: string | null; body: string | null; delivered: boolean | null };

// ---------------------------------------------------------------------------
// Registro de eventos explícitos
// ---------------------------------------------------------------------------

/** Guarda un evento. Nunca lanza: el historial no debe romper ningún flujo. */
export async function logBubuiActivity(e: {
  customerId: string;
  type: ClientShareType | (typeof SERVER_EVENT_TYPES)[number];
  businessId?: string | null;
  offerId?: string | null;
  channel?: string | null;
  platform?: string | null;
  appBuild?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await prisma.bubuiActivityEvent.create({
      data: {
        customerId: e.customerId,
        type: e.type,
        businessId: e.businessId ?? null,
        offerId: e.offerId ?? null,
        channel: e.channel ?? null,
        platform: e.platform ?? null,
        appBuild: e.appBuild ?? null,
        meta: (e.meta ?? undefined) as any
      }
    });
  } catch (err) {
    console.warn("[bubui activity] no se pudo registrar el evento", e.type, err);
  }
}

/** Plataforma aproximada a partir del User-Agent (app nativa vs. navegador). */
export function platformFromUserAgent(ua: string | null | undefined): "android" | "ios" | "web" | null {
  if (!ua) return null;
  if (/okhttp|Android(?!.*(Chrome|Firefox|Safari))/i.test(ua)) return "android";
  if (/CFNetwork|Darwin/i.test(ua)) return "ios";
  if (/Mozilla/i.test(ua)) return "web";
  return null;
}

// ---------------------------------------------------------------------------
// Texto de cada evento (puro, testeable)
// ---------------------------------------------------------------------------

const TZ = "Europe/Madrid";

function eur(n: number): string {
  return `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function day(d: Date): string {
  return d.toLocaleDateString("es-ES", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
}

function dayTime(d: Date): string {
  return d.toLocaleString("es-ES", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function prize(discountPct: number, rewardLabel: string | null): string {
  return rewardLabel?.trim() ? rewardLabel.trim() : `${discountPct}%`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "por WhatsApp",
  share_sheet: "con el menú de compartir",
  copy: "copiando el enlace",
  qr: "por QR"
};

const PLATFORM_LABEL: Record<string, string> = { web: "web", android: "Android", ios: "iOS" };

function joinParts(parts: Array<string | null | undefined | false>): string | null {
  const out = parts.filter((p): p is string => typeof p === "string" && p.length > 0);
  return out.length ? out.join(" · ") : null;
}

const CONTRIBUTION_LABEL: Record<string, string> = {
  share: "compartir con amigos",
  review: "reseña en Google",
  photo: "foto en redes",
  follow: "seguir en redes"
};

const TABLE_STATUS: Record<string, string> = {
  open: "Abierta",
  verified: "Verificada",
  redeemed: "Canjeada",
  expired: "Caducada"
};

const PUSH_KIND_LABEL: Record<string, string> = {
  ad: "Push del día",
  offer_expiring: "Cupón a punto de caducar",
  expiring_4h: "Cupón a punto de caducar",
  new_offers: "Nuevos cupones",
  welcome: "Bienvenida",
  share_expiry: "Recordatorio de reto"
};

/** Convierte un evento en bruto en la fila que ve el admin. */
export function describeActivity(raw: RawActivity, bizName: (id: string | null) => string | null): ActivityItem {
  const base = { id: `${raw.type}:${raw.id}`, at: raw.at.toISOString(), type: raw.type };
  const item = (
    kind: ActivityKind,
    title: string,
    rest: Partial<Pick<ActivityItem, "detail" | "businessId" | "amount" | "status" | "tone">> = {}
  ): ActivityItem => {
    const businessId = rest.businessId ?? null;
    return {
      ...base,
      kind,
      title,
      detail: rest.detail ?? null,
      businessId,
      businessName: bizName(businessId),
      amount: rest.amount ?? null,
      status: rest.status ?? null,
      tone: rest.tone ?? "neutral"
    };
  };
  const biz = (id: string | null) => bizName(id) ?? "un comercio";

  switch (raw.type) {
    case "signup":
      return item("account", "Se registró en Bubui", {
        businessId: raw.businessId,
        detail: joinParts([
          raw.referredByName ? `Invitado por ${raw.referredByName}` : null,
          raw.businessId ? `Llegó desde ${biz(raw.businessId)}` : null
        ])
      });
    case "login":
      return item("account", "Inició sesión", {
        detail: joinParts([
          raw.platform ? PLATFORM_LABEL[raw.platform] ?? raw.platform : null,
          raw.appBuild ? `build ${raw.appBuild}` : null
        ])
      });
    case "purchase_scanned": {
      const status =
        raw.status === "confirmed"
          ? "Confirmada"
          : raw.status === "rejected"
            ? `Rechazada${raw.rejectionReason ? `: ${raw.rejectionReason}` : ""}`
            : "Pendiente de confirmar";
      return item("scan", `Escaneó el QR de ${biz(raw.businessId)}`, {
        businessId: raw.businessId,
        amount: raw.amount,
        status,
        tone: raw.status === "confirmed" ? "ok" : raw.status === "rejected" ? "bad" : "pending",
        detail: joinParts([
          `${eur(raw.amount)} con ${raw.discountPct}% de descuento (${eur(raw.discountAmount)})`,
          raw.usedCoupon ? "con cupón" : null,
          raw.walletPctUsed > 0 ? `usó ${raw.walletPctUsed}% de su hucha` : null,
          raw.scanDistanceM != null ? `a ${Math.round(raw.scanDistanceM)} m del local` : null
        ])
      });
    }
    case "purchase_confirmed":
      return item("purchase", `Compra confirmada en ${biz(raw.businessId)}`, {
        businessId: raw.businessId,
        amount: raw.amount,
        tone: "ok",
        detail: `${eur(raw.amount)} · ahorró ${eur(raw.discountAmount)}`
      });
    case "ticket_scanned":
      return item("scan", raw.businessId ? `Subió la foto de un ticket de ${biz(raw.businessId)}` : "Subió la foto de un ticket", {
        businessId: raw.businessId,
        amount: raw.amount,
        detail: joinParts([
          raw.amount != null ? `La IA leyó ${eur(raw.amount)}` : "La IA no pudo leer el importe",
          raw.used ? null : "no llegó a usarse en una compra"
        ])
      });
    case "offer_unlocked": {
      const p = prize(raw.discountPct, raw.rewardLabel);
      const b = biz(raw.businessId);
      const expiry = `caduca el ${day(raw.expiresAt)}`;
      if (raw.source === "share_challenge") {
        return item("coupon", `Desbloqueó un reto de ${p} en ${b}`, {
          businessId: raw.businessId,
          status: raw.active ? "Activado" : "Bloqueado",
          tone: raw.active ? "ok" : "pending",
          detail: joinParts([`Tiene que traer ${raw.unlockShares} amigo${raw.unlockShares === 1 ? "" : "s"}`, expiry])
        });
      }
      const title =
        raw.source === "referral_welcome"
          ? `Cupón de bienvenida de ${p} en ${b}`
          : raw.source === "referral"
            ? `Premio por invitar amigos: ${p} en ${b}`
            : raw.source === "review_reward"
              ? `Cupón por reseña: ${p} en ${b}`
              : raw.source === "mesa" || raw.source === "mesa_followup"
                ? `Cupón de Mesa Colectiva: ${p} en ${b}`
                : `Recibió un cupón de ${p} en ${b}`;
      return item("coupon", title, { businessId: raw.businessId, detail: expiry });
    }
    case "offer_redeemed":
      return item("coupon", `Canjeó un cupón de ${prize(raw.discountPct, raw.rewardLabel)} en ${biz(raw.businessId)}`, {
        businessId: raw.businessId,
        tone: "ok",
        detail: raw.source === "share_challenge" ? "Cupón de reto" : null
      });
    case "custom_deal_claimed":
      return item("coupon", `Aceptó el reto de ${biz(raw.businessId)}`, {
        businessId: raw.businessId,
        detail: `${raw.clientDiscountPct}%${raw.title ? ` en ${raw.title}` : ""} si trae ${raw.friendsRequired} amigo${raw.friendsRequired === 1 ? "" : "s"}`
      });
    case "share": {
      const b = raw.businessId ? biz(raw.businessId) : null;
      const title =
        raw.shareType === "offer_shared"
          ? b ? `Compartió una oferta de ${b}` : "Compartió una oferta"
          : raw.shareType === "business_shared"
            ? b ? `Compartió la ficha de ${b}` : "Compartió la ficha de un comercio"
            : raw.shareType === "challenge_link_shared"
              ? b ? `Compartió su reto de ${b}` : "Compartió su reto"
              : raw.shareType === "challenge_reminder_shared"
                ? "Recordó el reto a un amigo"
                : "Compartió su enlace de invitación";
      return item("share", title, {
        businessId: raw.businessId,
        detail: joinParts([
          raw.channel ? CHANNEL_LABEL[raw.channel] ?? raw.channel : null,
          raw.platform ? PLATFORM_LABEL[raw.platform] ?? raw.platform : null
        ])
      });
    }
    case "referral_link_opened":
      return item("share", "Alguien abrió su enlace de invitación", {
        businessId: raw.businessId,
        detail: joinParts([
          raw.businessId ? `Oferta de ${biz(raw.businessId)}` : null,
          raw.platform ? PLATFORM_LABEL[raw.platform] ?? raw.platform : null
        ])
      });
    case "friend_signup":
      return item("friends", `${raw.friendName?.trim() || "Un amigo"} se registró con su invitación`, {
        status: raw.phoneVerified ? "Teléfono verificado" : "Sin verificar",
        tone: raw.phoneVerified ? "ok" : "pending"
      });
    case "challenge_friend_decided": {
      const friend = raw.friendName?.trim() || "un amigo";
      const b = biz(raw.businessId);
      const title =
        raw.status === "confirmed"
          ? `${b} confirmó a ${friend} en su reto`
          : raw.status === "declined"
            ? `${b} rechazó a ${friend} en su reto`
            : `${friend} no completó su reto en ${b}`;
      return item("friends", title, {
        businessId: raw.businessId,
        tone: raw.status === "confirmed" ? "ok" : "bad"
      });
    }
    case "joined_challenge":
      return item("friends", `Se unió al reto de ${raw.referrerName?.trim() || "un amigo"} en ${biz(raw.businessId)}`, {
        businessId: raw.businessId
      });
    case "challenge_contact":
      return item("friends", `Contactó con ${biz(raw.businessId)} para el reto`, {
        businessId: raw.businessId,
        detail: raw.channel ? CHANNEL_LABEL[raw.channel] ?? raw.channel : null
      });
    case "review":
      return item("review", `Valoró ${biz(raw.businessId)} con ${raw.rating}★`, {
        businessId: raw.businessId,
        detail: raw.comment?.trim() ? `“${truncate(raw.comment.trim(), 200)}”` : null
      });
    case "google_review":
      return item("review", `Reseña en Google verificada de ${biz(raw.businessId)}`, { businessId: raw.businessId, tone: "ok" });
    case "social_follow":
      return item("review", `Sigue a ${biz(raw.businessId)} en redes (verificado)`, { businessId: raw.businessId, tone: "ok" });
    case "table_created":
      return item("table", `Abrió una Mesa Colectiva en ${biz(raw.businessId)}`, {
        businessId: raw.businessId,
        status: TABLE_STATUS[raw.status] ?? raw.status,
        tone: raw.status === "redeemed" ? "ok" : raw.status === "expired" ? "bad" : "pending",
        detail: joinParts([
          raw.tableLabel ? `Mesa ${raw.tableLabel}` : null,
          raw.finalPct != null ? `${raw.finalPct}% aplicado` : null
        ])
      });
    case "table_joined":
      return item("table", `Se unió a una Mesa Colectiva en ${biz(raw.businessId)}`, {
        businessId: raw.businessId,
        detail: raw.isNewUser ? "Se instaló la app al unirse" : null
      });
    case "table_contributed":
      return item("table", `Aportó a la Mesa Colectiva en ${biz(raw.businessId)}`, {
        businessId: raw.businessId,
        detail: raw.contributionType ? CONTRIBUTION_LABEL[raw.contributionType] ?? raw.contributionType : null
      });
    case "booking":
      return item("booking", `Pidió cita en ${biz(raw.businessId)}`, {
        businessId: raw.businessId,
        status: raw.status === "confirmed" ? "Confirmada" : raw.status === "cancelled" ? "Cancelada" : "Pendiente",
        tone: raw.status === "confirmed" ? "ok" : raw.status === "cancelled" ? "bad" : "pending",
        detail: joinParts([raw.serviceName, `para el ${dayTime(raw.startsAt)}`])
      });
    case "push":
      return item("push", `Notificación: ${raw.title?.trim() || PUSH_KIND_LABEL[raw.kind] || raw.kind}`, {
        detail: raw.body?.trim() ? truncate(raw.body.trim(), 160) : null,
        status: raw.delivered === false ? "No entregada" : null,
        tone: raw.delivered === false ? "bad" : "neutral"
      });
  }
}

/**
 * Ordena (más reciente primero) y corta en `limit`. Si el corte cae en mitad de
 * varios eventos con la misma fecha, los incluye todos para que la siguiente
 * página (que pide `before = fecha del último`) no se salte ninguno.
 */
export function paginateActivity(items: ActivityItem[], limit: number): { items: ActivityItem[]; nextBefore: string | null } {
  const sorted = [...items].sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at < b.at ? 1 : -1));
  if (sorted.length <= limit) return { items: sorted, nextBefore: null };
  let end = limit;
  const boundary = sorted[limit - 1].at;
  while (end < sorted.length && sorted[end].at === boundary) end++;
  const page = sorted.slice(0, end);
  return { items: page, nextBefore: end < sorted.length ? boundary : null };
}

// ---------------------------------------------------------------------------
// Carga desde la base de datos
// ---------------------------------------------------------------------------

function pushText(payload: unknown, key: "title" | "body"): string | null {
  if (payload && typeof payload === "object" && typeof (payload as any)[key] === "string") return (payload as any)[key];
  return null;
}

function pushDelivered(payload: unknown): boolean | null {
  const s = payload && typeof payload === "object" ? (payload as any).deliveryStatus : undefined;
  return s === "accepted" ? true : s === "failed" ? false : null;
}

export async function loadCustomerActivity(
  customerId: string,
  opts: { before?: Date | null; limit?: number; kinds?: ActivityKind[] | null } = {}
): Promise<{ items: ActivityItem[]; nextBefore: string | null } | null> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const before = opts.before ?? new Date(Date.now() + 60_000);
  const kinds = new Set<ActivityKind>(opts.kinds?.length ? opts.kinds : ACTIVITY_KINDS);
  const want = (k: ActivityKind) => kinds.has(k);
  const take = limit + 1;
  const lt = { lt: before };

  const customer = await prisma.bubuiCustomer.findUnique({
    where: { id: customerId },
    select: { id: true, createdAt: true, referralCode: true, referredById: true, firstBusinessId: true }
  });
  if (!customer) return null;

  const none = Promise.resolve([] as any[]);
  const eventTypes = [...(want("account") ? SERVER_EVENT_TYPES : []), ...(want("share") ? CLIENT_SHARE_TYPES : [])];

  const [
    events,
    scanned,
    confirmed,
    tickets,
    offersCreated,
    offersRedeemed,
    deals,
    clicks,
    friends,
    decided,
    joined,
    contacts,
    reviews,
    googleReviews,
    follows,
    tablesCreated,
    tablesJoined,
    tablesContributed,
    bookings,
    pushes,
    referrer
  ] = await Promise.all([
    eventTypes.length
      ? prisma.bubuiActivityEvent.findMany({
          where: { customerId, createdAt: lt, type: { in: eventTypes as string[] } },
          orderBy: { createdAt: "desc" },
          take
        })
      : none,
    want("scan")
      ? prisma.bubuiPurchase.findMany({
          where: { customerId, scannedAt: lt },
          orderBy: { scannedAt: "desc" },
          take,
          select: {
            id: true,
            businessId: true,
            amount: true,
            discountPct: true,
            discountAmount: true,
            status: true,
            rejectionReason: true,
            redeemedOfferId: true,
            walletPctUsed: true,
            scanDistanceM: true,
            scannedAt: true
          }
        })
      : none,
    want("purchase")
      ? prisma.bubuiPurchase.findMany({
          where: { customerId, status: "confirmed", confirmedAt: lt },
          orderBy: { confirmedAt: "desc" },
          take,
          select: { id: true, businessId: true, amount: true, discountAmount: true, confirmedAt: true }
        })
      : none,
    want("scan")
      ? prisma.bubuiTicketScan.findMany({
          where: { customerId, createdAt: lt },
          orderBy: { createdAt: "desc" },
          take,
          select: { id: true, businessId: true, amount: true, usedByPurchaseId: true, createdAt: true }
        })
      : none,
    want("coupon")
      ? prisma.bubuiOffer.findMany({
          where: { customerId, createdAt: lt },
          orderBy: { createdAt: "desc" },
          take,
          select: {
            id: true,
            businessId: true,
            discountPct: true,
            rewardLabel: true,
            source: true,
            unlockShares: true,
            active: true,
            expiresAt: true,
            createdAt: true
          }
        })
      : none,
    want("coupon")
      ? prisma.bubuiOffer.findMany({
          where: { customerId, redeemed: true, redeemedAt: lt },
          orderBy: { redeemedAt: "desc" },
          take,
          select: { id: true, businessId: true, discountPct: true, rewardLabel: true, source: true, redeemedAt: true }
        })
      : none,
    want("coupon")
      ? prisma.bubuiCustomDeal.findMany({
          where: { claimedByCustomerId: customerId, claimedAt: lt },
          orderBy: { claimedAt: "desc" },
          take,
          select: { id: true, businessId: true, clientDiscountPct: true, friendsRequired: true, title: true, claimedAt: true }
        })
      : none,
    want("share") && customer.referralCode
      ? prisma.bubuiReferralClick.findMany({
          where: { code: customer.referralCode, createdAt: lt },
          orderBy: { createdAt: "desc" },
          take,
          select: { id: true, offerId: true, ua: true, createdAt: true }
        })
      : none,
    want("friends")
      ? prisma.bubuiCustomer.findMany({
          where: { referredById: customerId, createdAt: lt },
          orderBy: { createdAt: "desc" },
          take,
          select: { id: true, name: true, phoneVerified: true, createdAt: true }
        })
      : none,
    want("friends")
      ? prisma.bubuiChallengeParticipant.findMany({
          where: { referrerCustomerId: customerId, status: { in: ["confirmed", "declined", "lost"] }, decidedAt: lt },
          orderBy: { decidedAt: "desc" },
          take,
          select: { id: true, businessId: true, friendCustomerId: true, status: true, decidedAt: true }
        })
      : none,
    want("friends")
      ? prisma.bubuiChallengeParticipant.findMany({
          where: { friendCustomerId: customerId, registeredAt: lt },
          orderBy: { registeredAt: "desc" },
          take,
          select: { id: true, businessId: true, referrerCustomerId: true, registeredAt: true }
        })
      : none,
    want("friends")
      ? prisma.bubuiChallengeParticipant.findMany({
          where: { friendCustomerId: customerId, contactedAt: lt },
          orderBy: { contactedAt: "desc" },
          take,
          select: { id: true, businessId: true, contactChannel: true, contactedAt: true }
        })
      : none,
    want("review")
      ? prisma.bubuiReview.findMany({
          where: { customerId, createdAt: lt },
          orderBy: { createdAt: "desc" },
          take,
          select: { id: true, businessId: true, rating: true, comment: true, createdAt: true }
        })
      : none,
    want("review")
      ? prisma.bubuiGoogleReview.findMany({
          where: { customerId, createdAt: lt },
          orderBy: { createdAt: "desc" },
          take,
          select: { id: true, businessId: true, createdAt: true }
        })
      : none,
    want("review")
      ? prisma.bubuiSocialFollow.findMany({
          where: { customerId, createdAt: lt },
          orderBy: { createdAt: "desc" },
          take,
          select: { id: true, businessId: true, createdAt: true }
        })
      : none,
    want("table")
      ? prisma.bubuiTableSession.findMany({
          where: { captainId: customerId, createdAt: lt },
          orderBy: { createdAt: "desc" },
          take,
          select: { id: true, businessId: true, tableLabel: true, status: true, finalPct: true, createdAt: true }
        })
      : none,
    want("table")
      ? prisma.bubuiTableParticipant.findMany({
          where: {
            customerId,
            joinedAt: lt,
            OR: [{ session: { captainId: null } }, { session: { captainId: { not: customerId } } }]
          },
          orderBy: { joinedAt: "desc" },
          take,
          select: { id: true, isNewUser: true, joinedAt: true, session: { select: { businessId: true } } }
        })
      : none,
    want("table")
      ? prisma.bubuiTableParticipant.findMany({
          where: { customerId, contributedAt: lt },
          orderBy: { contributedAt: "desc" },
          take,
          select: { id: true, contributionType: true, contributedAt: true, session: { select: { businessId: true } } }
        })
      : none,
    want("booking")
      ? prisma.bubuiBooking.findMany({
          where: { customerId, createdAt: lt },
          orderBy: { createdAt: "desc" },
          take,
          select: { id: true, businessId: true, startsAt: true, status: true, createdAt: true, service: { select: { name: true } } }
        })
      : none,
    want("push")
      ? prisma.bubuiPushLog.findMany({
          where: { customerId, sentAt: lt },
          orderBy: { sentAt: "desc" },
          take,
          select: { id: true, kind: true, payload: true, sentAt: true }
        })
      : none,
    want("account") && customer.referredById
      ? prisma.bubuiCustomer.findUnique({ where: { id: customer.referredById }, select: { name: true } })
      : Promise.resolve(null)
  ]);

  // Nombres de otros clientes (amigos del reto / quien le invitó al reto).
  const otherIds = new Set<string>();
  for (const d of decided as any[]) otherIds.add(d.friendCustomerId);
  for (const j of joined as any[]) otherIds.add(j.referrerCustomerId);
  const others = otherIds.size
    ? await prisma.bubuiCustomer.findMany({ where: { id: { in: [...otherIds] } }, select: { id: true, name: true } })
    : [];
  const otherName = new Map(others.map((o) => [o.id, o.name]));

  // Oferta → comercio, para los clics en enlaces de invitación.
  const clickOfferIds = [...new Set((clicks as any[]).map((c) => c.offerId).filter(Boolean))] as string[];
  const clickOffers = clickOfferIds.length
    ? await prisma.bubuiOffer.findMany({ where: { id: { in: clickOfferIds } }, select: { id: true, businessId: true } })
    : [];
  const offerBusiness = new Map(clickOffers.map((o) => [o.id, o.businessId]));

  const raws: RawActivity[] = [];
  if (want("account") && customer.createdAt < before) {
    raws.push({
      type: "signup",
      id: customer.id,
      at: customer.createdAt,
      referredByName: (referrer as { name: string | null } | null)?.name ?? null,
      businessId: customer.firstBusinessId
    });
  }
  for (const e of events as any[]) {
    if (e.type === "login") {
      raws.push({ type: "login", id: e.id, at: e.createdAt, platform: e.platform, appBuild: e.appBuild });
    } else {
      raws.push({ type: "share", id: e.id, at: e.createdAt, shareType: e.type, businessId: e.businessId, channel: e.channel, platform: e.platform });
    }
  }
  for (const p of scanned as any[]) {
    raws.push({
      type: "purchase_scanned",
      id: p.id,
      at: p.scannedAt,
      businessId: p.businessId,
      amount: p.amount,
      discountPct: p.discountPct,
      discountAmount: p.discountAmount,
      status: p.status,
      rejectionReason: p.rejectionReason,
      usedCoupon: !!p.redeemedOfferId,
      walletPctUsed: p.walletPctUsed ?? 0,
      scanDistanceM: p.scanDistanceM
    });
  }
  for (const p of confirmed as any[]) {
    raws.push({ type: "purchase_confirmed", id: p.id, at: p.confirmedAt, businessId: p.businessId, amount: p.amount, discountAmount: p.discountAmount });
  }
  for (const t of tickets as any[]) {
    raws.push({ type: "ticket_scanned", id: t.id, at: t.createdAt, businessId: t.businessId, amount: t.amount, used: !!t.usedByPurchaseId });
  }
  for (const o of offersCreated as any[]) {
    raws.push({
      type: "offer_unlocked",
      id: o.id,
      at: o.createdAt,
      businessId: o.businessId,
      discountPct: o.discountPct,
      rewardLabel: o.rewardLabel,
      source: o.source,
      unlockShares: o.unlockShares,
      active: o.active,
      expiresAt: o.expiresAt
    });
  }
  for (const o of offersRedeemed as any[]) {
    raws.push({ type: "offer_redeemed", id: o.id, at: o.redeemedAt, businessId: o.businessId, discountPct: o.discountPct, rewardLabel: o.rewardLabel, source: o.source });
  }
  for (const d of deals as any[]) {
    raws.push({
      type: "custom_deal_claimed",
      id: d.id,
      at: d.claimedAt,
      businessId: d.businessId,
      clientDiscountPct: d.clientDiscountPct,
      friendsRequired: d.friendsRequired,
      title: d.title
    });
  }
  for (const c of clicks as any[]) {
    raws.push({
      type: "referral_link_opened",
      id: c.id,
      at: c.createdAt,
      businessId: c.offerId ? offerBusiness.get(c.offerId) ?? null : null,
      platform: c.ua === "android" || c.ua === "ios" ? c.ua : null
    });
  }
  for (const f of friends as any[]) {
    raws.push({ type: "friend_signup", id: f.id, at: f.createdAt, friendName: f.name, phoneVerified: f.phoneVerified });
  }
  for (const d of decided as any[]) {
    raws.push({
      type: "challenge_friend_decided",
      id: d.id,
      at: d.decidedAt,
      businessId: d.businessId,
      friendName: otherName.get(d.friendCustomerId) ?? null,
      status: d.status
    });
  }
  for (const j of joined as any[]) {
    raws.push({ type: "joined_challenge", id: j.id, at: j.registeredAt, businessId: j.businessId, referrerName: otherName.get(j.referrerCustomerId) ?? null });
  }
  for (const c of contacts as any[]) {
    raws.push({ type: "challenge_contact", id: c.id, at: c.contactedAt, businessId: c.businessId, channel: c.contactChannel });
  }
  for (const r of reviews as any[]) {
    raws.push({ type: "review", id: r.id, at: r.createdAt, businessId: r.businessId, rating: r.rating, comment: r.comment });
  }
  for (const r of googleReviews as any[]) raws.push({ type: "google_review", id: r.id, at: r.createdAt, businessId: r.businessId });
  for (const r of follows as any[]) raws.push({ type: "social_follow", id: r.id, at: r.createdAt, businessId: r.businessId });
  for (const t of tablesCreated as any[]) {
    raws.push({ type: "table_created", id: t.id, at: t.createdAt, businessId: t.businessId, tableLabel: t.tableLabel, status: t.status, finalPct: t.finalPct });
  }
  for (const t of tablesJoined as any[]) {
    raws.push({ type: "table_joined", id: t.id, at: t.joinedAt, businessId: t.session.businessId, isNewUser: t.isNewUser });
  }
  for (const t of tablesContributed as any[]) {
    raws.push({ type: "table_contributed", id: t.id, at: t.contributedAt, businessId: t.session.businessId, contributionType: t.contributionType });
  }
  for (const b of bookings as any[]) {
    raws.push({ type: "booking", id: b.id, at: b.createdAt, businessId: b.businessId, startsAt: b.startsAt, status: b.status, serviceName: b.service?.name ?? null });
  }
  for (const p of pushes as any[]) {
    raws.push({
      type: "push",
      id: p.id,
      at: p.sentAt,
      kind: p.kind,
      title: pushText(p.payload, "title"),
      body: pushText(p.payload, "body"),
      delivered: pushDelivered(p.payload)
    });
  }

  // Nombres de comercio en una sola consulta.
  const businessIds = new Set<string>();
  for (const r of raws) {
    const id = (r as { businessId?: string | null }).businessId;
    if (id) businessIds.add(id);
  }
  const businesses = businessIds.size
    ? await prisma.bubuiBusiness.findMany({ where: { id: { in: [...businessIds] } }, select: { id: true, name: true } })
    : [];
  const names = new Map(businesses.map((b) => [b.id, b.name]));
  const bizName = (id: string | null) => (id ? names.get(id) ?? null : null);

  return paginateActivity(
    raws.map((r) => describeActivity(r, bizName)),
    limit
  );
}

/** Totales históricos del cliente para la cabecera del historial. */
export async function loadCustomerActivitySummary(customerId: string) {
  const [scans, pending, confirmed, redeemed, shares, friends, reviews, googleReviews, linkOpens] = await Promise.all([
    prisma.bubuiPurchase.count({ where: { customerId } }),
    prisma.bubuiPurchase.count({ where: { customerId, status: "pending" } }),
    prisma.bubuiPurchase.aggregate({
      where: { customerId, status: "confirmed" },
      _count: { _all: true },
      _sum: { amount: true, discountAmount: true }
    }),
    prisma.bubuiOffer.count({ where: { customerId, redeemed: true } }),
    prisma.bubuiActivityEvent.count({ where: { customerId, type: { in: [...CLIENT_SHARE_TYPES] } } }),
    prisma.bubuiCustomer.count({ where: { referredById: customerId } }),
    prisma.bubuiReview.count({ where: { customerId } }),
    prisma.bubuiGoogleReview.count({ where: { customerId } }),
    prisma.bubuiCustomer
      .findUnique({ where: { id: customerId }, select: { referralCode: true } })
      .then((c) => (c?.referralCode ? prisma.bubuiReferralClick.count({ where: { code: c.referralCode } }) : 0))
  ]);
  return {
    scans,
    pendingPurchases: pending,
    purchases: confirmed._count._all,
    spent: confirmed._sum.amount ?? 0,
    saved: confirmed._sum.discountAmount ?? 0,
    couponsRedeemed: redeemed,
    shares,
    linkOpens,
    friends,
    reviews: reviews + googleReviews
  };
}
