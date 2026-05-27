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
import { decryptSecret } from "@/lib/ai/crypto";

export type GmbConfig = {
  replyWebhookUrl: string | null; // webhook de Make que publica la respuesta en Google
  ingestToken: string | null; // token compartido para validar webhooks entrantes
  notifyEmail: string | null; // email para avisos (reseñas negativas, etc.)
  telegram: string | null; // "botToken:chatId" para avisos por Telegram
};

export async function getGmbConfig(workspaceId: string): Promise<GmbConfig> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true }
  });
  const g = (ws?.settings as any)?.integrations?.gmb ?? {};
  const ingestToken = g.webhookTokenEnc
    ? decryptSecret(g.webhookTokenEnc)
    : typeof g.webhookToken === "string" && g.webhookToken
      ? g.webhookToken
      : process.env.GMB_WEBHOOK_TOKEN ?? null;
  return {
    replyWebhookUrl:
      typeof g.replyWebhookUrl === "string" && g.replyWebhookUrl
        ? g.replyWebhookUrl
        : process.env.GMB_REPLY_WEBHOOK_URL ?? null,
    ingestToken: ingestToken || null,
    notifyEmail: typeof g.notifyEmail === "string" && g.notifyEmail ? g.notifyEmail : process.env.GMB_NOTIFY_EMAIL ?? null,
    telegram: g.telegramEnc ? decryptSecret(g.telegramEnc) : typeof g.telegram === "string" && g.telegram ? g.telegram : null
  };
}

/** Crea una notificación in-app del GMB Hub. */
export async function createGmbNotification(opts: {
  workspaceId: string;
  clientId?: string | null;
  type: string;
  title: string;
  body?: string | null;
  data?: any;
}): Promise<void> {
  await prisma.gmbNotification.create({
    data: {
      workspaceId: opts.workspaceId,
      clientId: opts.clientId ?? null,
      type: opts.type,
      title: opts.title.slice(0, 200),
      body: opts.body?.slice(0, 2000) ?? null,
      data: opts.data ?? undefined
    }
  });
}

/** Envía un mensaje por Telegram si hay config "botToken:chatId". */
export async function sendTelegram(telegram: string | null, text: string): Promise<void> {
  if (!telegram || !telegram.includes(":")) return;
  const idx = telegram.indexOf(":");
  // formato esperado: "<botToken>:<chatId>" donde botToken ya contiene ':' → usamos el último ':' como separador del chatId
  const lastColon = telegram.lastIndexOf(":");
  const botToken = telegram.slice(0, lastColon);
  const chatId = telegram.slice(lastColon + 1);
  if (!botToken || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ chat_id: chatId, text })
    });
  } catch {}
  void idx;
}

/**
 * Procesa una reseña negativa recién llegada: genera borrador IA, crea
 * notificación in-app y avisa por email + Telegram. No lanza si algo falla.
 */
export async function handleNegativeReview(opts: {
  workspaceId: string;
  clientId: string;
  clientName: string;
  clientEmails?: string | null;
  rating: number;
  authorName: string;
  comment: string;
  tone: string;
}): Promise<void> {
  const cfg = await getGmbConfig(opts.workspaceId);
  let aiDraft = "";
  try {
    aiDraft = await generateReviewReply({
      workspaceId: opts.workspaceId,
      businessName: opts.clientName,
      tone: opts.tone || "empático y profesional",
      rating: opts.rating,
      comment: opts.comment
    });
  } catch {}

  await createGmbNotification({
    workspaceId: opts.workspaceId,
    clientId: opts.clientId,
    type: "negative_review",
    title: `Reseña ${opts.rating}★ en ${opts.clientName}`,
    body: `${opts.authorName}: ${opts.comment}`.slice(0, 500),
    data: { rating: opts.rating, aiDraft }
  });

  const stars = "★".repeat(opts.rating) + "☆".repeat(5 - opts.rating);
  const tgText = `⚠️ Reseña negativa (${stars}) en ${opts.clientName}\n${opts.authorName}: ${opts.comment}${aiDraft ? `\n\nBorrador IA:\n${aiDraft}` : ""}`;
  await sendTelegram(cfg.telegram, tgText);

  const recipients = (opts.clientEmails || cfg.notifyEmail || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (recipients.length > 0) {
    try {
      const { sendEmail, isEmailEnabled } = await import("./email");
      if (isEmailEnabled()) {
        await sendEmail({
          to: recipients,
          subject: `[GMB Hub] Reseña negativa (${opts.rating}★) — ${opts.clientName}`,
          html: `<div style="font-family:Arial,sans-serif"><h2>Reseña negativa en ${escapeHtml(opts.clientName)}</h2>
<p><strong>${escapeHtml(opts.authorName)}</strong> · ${stars}</p>
<p style="background:#f8f8f8;padding:12px;border-left:3px solid #e74c3c">${escapeHtml(opts.comment)}</p>
${aiDraft ? `<h3>Borrador de respuesta (IA)</h3><p style="background:#eef6ff;padding:12px;border-radius:8px">${escapeHtml(aiDraft)}</p>` : ""}</div>`
        });
      }
    } catch {}
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
}

/** Resuelve la Google Maps API key del workspace (settings cifrada → env). */
export async function getGmbMapsKey(workspaceId: string): Promise<string | null> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true }
  });
  const g = (ws?.settings as any)?.integrations?.gmb ?? {};
  if (g.mapsKeyEnc) {
    const k = decryptSecret(g.mapsKeyEnc);
    if (k) return k;
  }
  return process.env.GOOGLE_MAPS_API_KEY ?? null;
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
}): Promise<{
  ok: boolean;
  clientId?: string;
  reason?: string;
  created?: boolean;
  rating?: number;
  authorName?: string;
  comment?: string;
  clientName?: string;
  clientEmails?: string;
  tone?: string;
}> {
  // Resolver cliente
  const sel = { id: true, name: true, emails: true, tone: true, customTone: true } as const;
  let client = null as null | { id: string; name: string; emails: string; tone: string; customTone: string | null };
  if (opts.clientId) {
    client = await prisma.gmbClient.findFirst({
      where: { id: opts.clientId, workspaceId: opts.workspaceId },
      select: sel
    });
  }
  if (!client && opts.locationId) {
    client = await prisma.gmbClient.findFirst({
      where: { workspaceId: opts.workspaceId, locationId: { contains: opts.locationId.replace("locations/", "") } },
      select: sel
    });
  }
  if (!client && opts.accountId) {
    client = await prisma.gmbClient.findFirst({
      where: { workspaceId: opts.workspaceId, accountId: { contains: opts.accountId } },
      select: sel
    });
  }
  if (!client) return { ok: false, reason: "cliente no encontrado" };

  const r = opts.review;
  const reviewId = r.reviewId && String(r.reviewId).trim() ? String(r.reviewId).trim() : null;
  if (!reviewId) return { ok: false, reason: "review sin reviewId" };
  const rating = starWordToRating(r.rating);

  const existing = await prisma.gmbReview.findUnique({
    where: { clientId_reviewId: { clientId: client.id, reviewId } },
    select: { id: true }
  });

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
  return {
    ok: true,
    clientId: client.id,
    created: !existing,
    rating,
    authorName: r.authorName ?? "",
    comment: r.comment ?? "",
    clientName: client.name,
    clientEmails: client.emails,
    tone: client.tone === "custom" && client.customTone ? client.customTone : client.tone
  };
}

export type SeoAudit = {
  score: number;
  issues: string[];
  recommendations: string[];
  checks: { label: string; ok: boolean }[];
};

/**
 * Auditoría SEO local de una ficha (heurística sobre sus campos + reseñas),
 * replicando la lógica del plugin. Sin llamadas externas.
 */
export function computeSeoAudit(c: {
  name: string;
  description?: string | null;
  category?: string | null;
  mainKeyword?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
}): SeoAudit {
  const checks: { label: string; ok: boolean; weight: number; rec: string }[] = [];
  const desc = (c.description ?? "").trim();
  const kw = (c.mainKeyword ?? "").trim().toLowerCase();
  checks.push({ label: "Nombre del negocio", ok: !!c.name?.trim(), weight: 10, rec: "Añade el nombre del negocio." });
  checks.push({ label: "Categoría definida", ok: !!(c.category ?? "").trim(), weight: 10, rec: "Define la categoría principal del negocio." });
  checks.push({ label: "Descripción ≥ 250 caracteres", ok: desc.length >= 250, weight: 15, rec: "Escribe una descripción de al menos 250 caracteres con tu keyword principal." });
  checks.push({ label: "Keyword principal en la descripción", ok: !!kw && desc.toLowerCase().includes(kw), weight: 15, rec: "Incluye tu keyword principal de forma natural en la descripción." });
  checks.push({ label: "Teléfono", ok: !!(c.phone ?? "").trim(), weight: 10, rec: "Añade un teléfono de contacto." });
  checks.push({ label: "Sitio web", ok: !!(c.website ?? "").trim(), weight: 10, rec: "Enlaza tu sitio web." });
  checks.push({ label: "Dirección", ok: !!(c.address ?? "").trim(), weight: 10, rec: "Completa la dirección física." });
  checks.push({ label: "Al menos 10 reseñas", ok: (c.reviewCount ?? 0) >= 10, weight: 10, rec: "Consigue más reseñas (objetivo ≥10) pidiéndolas a clientes satisfechos." });
  checks.push({ label: "Valoración ≥ 4.0", ok: (c.rating ?? 0) >= 4, weight: 10, rec: "Mejora la valoración respondiendo reseñas y resolviendo quejas." });

  const totalWeight = checks.reduce((s, c2) => s + c2.weight, 0);
  const gained = checks.filter((c2) => c2.ok).reduce((s, c2) => s + c2.weight, 0);
  const score = Math.round((gained / totalWeight) * 100);
  return {
    score,
    issues: checks.filter((c2) => !c2.ok).map((c2) => c2.label),
    recommendations: checks.filter((c2) => !c2.ok).map((c2) => c2.rec),
    checks: checks.map((c2) => ({ label: c2.label, ok: c2.ok }))
  };
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
