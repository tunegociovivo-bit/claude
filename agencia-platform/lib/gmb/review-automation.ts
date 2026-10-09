/**
 * Automatización de reseñas NUEVAS por ficha:
 *  - Respuesta automática (GmbClient.autoReply): manual | positive | negative | both
 *    (el antiguo valor "auto" equivale a "positive").
 *  - Aviso por email (GmbClient.notifyMode): none | positive | negative | both.
 * Positiva = 4-5★; negativa = 1-3★.
 * Se aplica a reseñas que llegan por la sincronización con Google (cron cada 30 min o al
 * abrir la ficha) y por el webhook de Make. Nunca se aplica al histórico de la primera importación.
 */
import { prisma } from "@/lib/db/prisma";
import { gmbReplyReview, gbpSourceForClient, gmbLocationPath } from "@/lib/integrations/gmb";
import { createGmbNotification, generateReviewReply, getGmbConfig, logGmbActivity, sendTelegram } from "@/lib/integrations/gmb-hub";

export type ReplyMode = "manual" | "positive" | "negative" | "both";
export type NotifyMode = "none" | "positive" | "negative" | "both";

export const REPLY_MODES: ReplyMode[] = ["manual", "positive", "negative", "both"];
export const NOTIFY_MODES: NotifyMode[] = ["none", "positive", "negative", "both"];

export function normalizeReplyMode(v: string | null | undefined): ReplyMode {
  if (v === "auto") return "positive";
  return (REPLY_MODES as string[]).includes(String(v)) ? (v as ReplyMode) : "manual";
}
export function normalizeNotifyMode(v: string | null | undefined): NotifyMode {
  return (NOTIFY_MODES as string[]).includes(String(v)) ? (v as NotifyMode) : "negative";
}

export const isPositive = (rating: number) => rating >= 4;

/** ¿El modo cubre una reseña con esta puntuación? */
export function modeMatches(mode: ReplyMode | NotifyMode, rating: number): boolean {
  if (mode === "both") return true;
  if (mode === "positive") return isPositive(rating);
  if (mode === "negative") return !isPositive(rating);
  return false;
}

function esc(s: string) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

type ClientLike = {
  id: string;
  workspaceId: string;
  name: string;
  tone: string;
  customTone?: string | null;
  accountId: string;
  locationId: string;
  emails: string;
  autoReply: string;
  notifyMode?: string | null;
  googleConnectionId?: string | null;
  connectionId?: string | null;
};

export type IncomingReview = { reviewId: string; rating: number; comment: string; authorName: string; hasReply: boolean };

/** Publica en Google una respuesta generada con IA y la guarda en el Hub. */
export async function autoReplyToReview(client: ClientLike, r: IncomingReview): Promise<{ ok: boolean; reply?: string; error?: string }> {
  const ws = client.workspaceId;
  const path = gmbLocationPath(client.accountId, client.locationId);
  if (!path) return { ok: false, error: "ficha sin vincular" };
  const tone = client.tone === "custom" && client.customTone ? client.customTone : client.tone;
  try {
    const reply = (await generateReviewReply({ workspaceId: ws, businessName: client.name, tone, rating: r.rating, comment: r.comment, authorName: r.authorName })).trim();
    if (!reply) return { ok: false, error: "la IA no devolvió respuesta" };
    await gmbReplyReview({ workspaceId: ws, reviewName: `${path}/reviews/${r.reviewId}`, comment: reply, source: gbpSourceForClient(client) });
    await prisma.gmbReview.updateMany({ where: { workspaceId: ws, clientId: client.id, reviewId: r.reviewId }, data: { reviewReply: reply } });
    await logGmbActivity({ workspaceId: ws, clientId: client.id, actionType: "auto_reply", description: `Respuesta automática publicada a la reseña ${r.rating}★ de ${r.authorName || "anónimo"}.` }).catch(() => {});
    return { ok: true, reply };
  } catch (e: any) {
    const error = String(e?.message ?? e).slice(0, 300);
    await logGmbActivity({ workspaceId: ws, clientId: client.id, actionType: "auto_reply_error", description: `No se pudo responder automáticamente a ${r.authorName || "anónimo"}: ${error}` }).catch(() => {});
    return { ok: false, error };
  }
}

/** Aviso de reseña nueva: notificación en el Hub siempre; email (y Telegram en negativas) según el modo. */
export async function notifyNewReview(client: ClientLike, r: IncomingReview, replied?: { ok: boolean; reply?: string; error?: string } | null) {
  const ws = client.workspaceId;
  const positive = isPositive(r.rating);
  const stars = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
  await createGmbNotification({
    workspaceId: ws,
    clientId: client.id,
    type: positive ? "new_review" : "negative_review",
    title: `Reseña ${r.rating}★ en ${client.name}`,
    body: `${r.authorName || "Anónimo"}: ${r.comment || "(sin texto)"}`.slice(0, 500),
    data: { rating: r.rating, reply: replied?.reply ?? null }
  }).catch(() => {});

  const mode = normalizeNotifyMode(client.notifyMode);
  if (!modeMatches(mode, r.rating)) return { emailed: false };
  const cfg = await getGmbConfig(ws);
  if (!positive) await sendTelegram(cfg.telegram, `⚠️ Reseña ${stars} en ${client.name}\n${r.authorName}: ${r.comment}`).catch(() => {});
  const to = (client.emails || cfg.notifyEmail || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!to.length) return { emailed: false, reason: "sin emails configurados" };
  try {
    const { sendEmail, isEmailEnabled } = await import("@/lib/integrations/email");
    if (!isEmailEnabled()) return { emailed: false, reason: "email no configurado" };
    const color = positive ? "#16a34a" : "#dc2626";
    const replyBlock = replied?.ok
      ? `<h3 style="font-size:14px;margin:18px 0 6px">Respondida automáticamente</h3><p style="background:#eef6ff;padding:12px;border-radius:8px">${esc(replied.reply ?? "")}</p>`
      : replied && !replied.ok
        ? `<p style="color:#b45309;font-size:13px">No se pudo publicar la respuesta automática: ${esc(replied.error ?? "")}</p>`
        : `<p style="font-size:13px;color:#475569">Puedes responderla desde el GMB Hub.</p>`;
    await sendEmail({
      to,
      subject: `[GMB Hub] Nueva reseña ${positive ? "positiva" : "negativa"} (${r.rating}★) — ${client.name}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;color:#0f172a">
<h2 style="margin:0 0 4px">Nueva reseña en ${esc(client.name)}</h2>
<p style="margin:0 0 12px"><strong>${esc(r.authorName || "Anónimo")}</strong> · <span style="color:#f5b301">${stars}</span></p>
<p style="background:#f8fafc;padding:12px;border-left:3px solid ${color};white-space:pre-wrap">${esc(r.comment || "(sin texto)")}</p>
${replyBlock}</div>`
    });
    return { emailed: true };
  } catch (e: any) {
    return { emailed: false, reason: String(e?.message ?? e) };
  }
}

/** Procesa una reseña nueva: primero responde (si toca) y luego avisa (si toca). */
export async function processNewReview(client: ClientLike, r: IncomingReview) {
  let replied: { ok: boolean; reply?: string; error?: string } | null = null;
  if (!r.hasReply && modeMatches(normalizeReplyMode(client.autoReply), r.rating)) replied = await autoReplyToReview(client, r);
  await notifyNewReview(client, r, replied);
  return { replied };
}

/* ───────────────────── Sincronización periódica (cron) ───────────────────── */

const lastRun = new Map<string, number>();
// Cada sincronización es 1 llamada a Google (vía Make, consume operaciones): cada 30 min por ficha.
const EVERY_MS = 30 * 60_000;

/** Sincroniza cada 30 minutos las fichas que tienen respuesta automática o avisos activos. */
export async function processAllReviewAutomation(maxClients = 40) {
  const { syncClientReviews } = await import("@/lib/gmb/review-sync");
  const clients = await prisma.gmbClient.findMany({
    where: {
      status: "active",
      locationId: { not: "" },
      OR: [{ autoReply: { notIn: ["manual", ""] } }, { notifyMode: { notIn: ["none", ""] } }]
    },
    select: { id: true, workspaceId: true },
    take: 500
  });
  let done = 0;
  for (const c of clients) {
    if (done >= maxClients) break;
    const last = lastRun.get(c.id) ?? 0;
    if (Date.now() - last < EVERY_MS) continue;
    lastRun.set(c.id, Date.now());
    done++;
    await syncClientReviews(c.workspaceId, c.id, { maxPages: 1, quiet: true }).catch((e) => console.warn("[gmb] review-automation:", c.id, (e as Error).message));
  }
  return { checked: done };
}
