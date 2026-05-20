/**
 * GMB Hub — lógica de servidor. Port del plugin WordPress (v3.0.0).
 *
 * Modelo de conexión con Google = VÍA MAKE.COM (igual que el plugin):
 *  - Las reseñas entran por webhook (Make → /api/v1/gmb/reviews/webhook).
 *  - Las respuestas salen por webhook a Make (settings.integrations.gmb.replyWebhookUrl),
 *    que las publica en Google Business Profile.
 * La IA de respuestas es OpenAI (gpt-4o-mini), como en el plugin.
 */

import { prisma } from "@/lib/db/prisma";

export type GmbConfig = {
  replyWebhookUrl: string | null; // webhook de Make que publica la respuesta en Google
  ingestToken: string | null; // token compartido para validar webhooks entrantes
};

export async function getGmbConfig(workspaceId: string): Promise<GmbConfig> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true }
  });
  const g = (ws?.settings as any)?.integrations?.gmb ?? {};
  return {
    replyWebhookUrl: typeof g.replyWebhookUrl === "string" && g.replyWebhookUrl ? g.replyWebhookUrl : null,
    ingestToken: typeof g.webhookToken === "string" && g.webhookToken ? g.webhookToken : null
  };
}

/** Convierte rating numérico (1-5) ↔ enum de Google ("ONE".."FIVE"). */
const STAR_WORDS = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE"];
export function ratingToStarWord(n: number): string {
  return STAR_WORDS[Math.max(0, Math.min(5, Math.round(n)))] ?? "ZERO";
}
export function starWordToRating(s: string | number | null | undefined): number {
  if (typeof s === "number") return Math.max(0, Math.min(5, Math.round(s)));
  const idx = STAR_WORDS.indexOf(String(s ?? "").toUpperCase());
  if (idx >= 0) return idx;
  const n = parseInt(String(s ?? ""), 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0;
}

/** Normaliza fechas ISO (T/Z) o MySQL a Date|null. */
export function parseDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Genera una respuesta a una reseña con OpenAI (gpt-4o-mini), replicando el
 * prompt del plugin: tono del negocio + empatía si rating ≤3.
 */
export async function generateReviewReply(opts: {
  workspaceId: string;
  businessName: string;
  tone: string;
  rating: number;
  comment: string;
}): Promise<string> {
  const { getOpenAiKeyForWorkspace } = await import("@/lib/ai/openai");
  const apiKey = await getOpenAiKeyForWorkspace(opts.workspaceId);
  const sentiment =
    opts.rating <= 3
      ? "Sé empático, pide disculpas si procede y ofrece solucionarlo. "
      : "Sé entusiasta y agradecido. ";
  const prompt =
    `Genera una respuesta ${opts.tone} a esta reseña de Google My Business para el negocio "${opts.businessName}". ` +
    sentiment +
    `Reseña (${opts.rating} estrellas): "${opts.comment}"\n\nRespuesta (máximo 200 palabras, en español):`;
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 300,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`OpenAI ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  return (data?.choices?.[0]?.message?.content ?? "").trim();
}

/**
 * Publica una respuesta en Google a través del webhook de Make (si está
 * configurado). Replica el body del plugin. Devuelve si se envió a Google.
 */
export async function publishReplyViaMake(opts: {
  workspaceId: string;
  accountId: string;
  locationId: string;
  reviewId: string;
  reply: string;
}): Promise<{ sentToGoogle: boolean; error?: string }> {
  const cfg = await getGmbConfig(opts.workspaceId);
  if (!cfg.replyWebhookUrl) return { sentToGoogle: false };
  try {
    const r = await fetch(cfg.replyWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        account: opts.accountId,
        location: opts.locationId.replace("locations/", ""),
        review_id: opts.reviewId,
        reply: opts.reply
      })
    });
    return { sentToGoogle: r.ok, error: r.ok ? undefined : `webhook ${r.status}` };
  } catch (e: any) {
    return { sentToGoogle: false, error: String(e?.message ?? e) };
  }
}

/** Registra una entrada de actividad para una ficha. */
export async function logGmbActivity(opts: {
  workspaceId: string;
  clientId: string;
  actionType: string;
  description: string;
}): Promise<void> {
  await prisma.gmbActivity
    .create({
      data: {
        workspaceId: opts.workspaceId,
        clientId: opts.clientId,
        actionType: opts.actionType,
        description: opts.description
      }
    })
    .catch(() => {});
}

/**
 * Inserta/actualiza una reseña entrante (desde Make). Resuelve el cliente por
 * locationId/accountId. Devuelve la reseña o null si no encuentra cliente.
 */
export async function upsertIncomingReview(opts: {
  workspaceId: string;
  clientId?: string;
  locationId?: string;
  accountId?: string;
  review: {
    reviewId?: string;
    authorName?: string;
    authorPhoto?: string;
    rating?: number | string;
    comment?: string;
    reply?: string;
    createTime?: string;
    updateTime?: string;
  };
}): Promise<{ ok: boolean; clientId?: string; reason?: string }> {
  // Resolver cliente
  let client = null as null | { id: string };
  if (opts.clientId) {
    client = await prisma.gmbClient.findFirst({
      where: { id: opts.clientId, workspaceId: opts.workspaceId },
      select: { id: true }
    });
  }
  if (!client && opts.locationId) {
    client = await prisma.gmbClient.findFirst({
      where: { workspaceId: opts.workspaceId, locationId: { contains: opts.locationId.replace("locations/", "") } },
      select: { id: true }
    });
  }
  if (!client && opts.accountId) {
    client = await prisma.gmbClient.findFirst({
      where: { workspaceId: opts.workspaceId, accountId: { contains: opts.accountId } },
      select: { id: true }
    });
  }
  if (!client) return { ok: false, reason: "cliente no encontrado" };

  const r = opts.review;
  const reviewId = r.reviewId && String(r.reviewId).trim() ? String(r.reviewId).trim() : null;
  if (!reviewId) return { ok: false, reason: "review sin reviewId" };
  const rating = starWordToRating(r.rating);

  await prisma.gmbReview.upsert({
    where: { clientId_reviewId: { clientId: client.id, reviewId } },
    create: {
      workspaceId: opts.workspaceId,
      clientId: client.id,
      reviewId,
      authorName: r.authorName ?? "",
      authorPhoto: r.authorPhoto ?? "",
      rating,
      comment: r.comment ?? "",
      reviewReply: r.reply ?? null,
      reviewTime: parseDate(r.createTime),
      updateTime: parseDate(r.updateTime)
    },
    update: {
      authorName: r.authorName ?? undefined,
      authorPhoto: r.authorPhoto ?? undefined,
      rating,
      comment: r.comment ?? undefined,
      reviewReply: r.reply ?? undefined,
      updateTime: parseDate(r.updateTime)
    }
  });
  return { ok: true, clientId: client.id };
}

/** Recalcula rating medio + nº reseñas de una ficha desde sus reseñas. */
export async function recomputeClientStats(clientId: string): Promise<void> {
  const agg = await prisma.gmbReview.aggregate({
    where: { clientId },
    _avg: { rating: true },
    _count: { _all: true }
  });
  await prisma.gmbClient
    .update({
      where: { id: clientId },
      data: {
        rating: Number((agg._avg.rating ?? 0).toFixed(1)),
        reviewCount: agg._count._all
      }
    })
    .catch(() => {});
}
