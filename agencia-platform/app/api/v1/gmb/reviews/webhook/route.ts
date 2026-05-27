/**
 * POST /api/v1/gmb/reviews/webhook  (PÚBLICO, validado por token)
 *
 * Punto de entrada de reseñas desde Make.com (igual que el plugin original).
 * Make tiene la conexión de Google y empuja las reseñas aquí. Acepta:
 *  - Una reseña suelta: { token, workspaceId, clientId|locationId|accountId, reviewId, ... }
 *  - Un lote: { token, workspaceId, clientId, reviews: [ {...}, ... ] }
 *
 * El token debe coincidir con settings.integrations.gmb.webhookToken del
 * workspace indicado. Sin token válido → 401.
 */
import { NextRequest, NextResponse } from "next/server";
import { rateLimitPublic } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import {
  upsertIncomingReview,
  recomputeClientStats,
  getGmbConfig,
  handleNegativeReview,
  generateReviewReply,
  publishReplyViaMake,
  logGmbActivity
} from "@/lib/integrations/gmb-hub";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = rateLimitPublic(req, { tag: "gmb-webhook", limit: 120 });
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const token = String(body.token ?? req.headers.get("x-webhook-token") ?? "").trim();
  const workspaceId = String(body.workspaceId ?? "").trim();
  if (!token || !workspaceId) {
    return NextResponse.json({ error: "missing_token_or_workspace" }, { status: 401 });
  }
  // Validar token contra la config del workspace (token cifrado en settings)
  const cfg = await getGmbConfig(workspaceId);
  if (!cfg.ingestToken || token !== cfg.ingestToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const reviewsArr: any[] = Array.isArray(body.reviews) ? body.reviews : [body];
  const touchedClients = new Set<string>();
  let ok = 0;
  let failed = 0;
  for (const r of reviewsArr) {
    const res = await upsertIncomingReview({
      workspaceId,
      clientId: body.clientId ?? r.clientId,
      locationId: body.locationId ?? r.locationId ?? r.location,
      accountId: body.accountId ?? r.accountId ?? r.account,
      review: {
        reviewId: r.reviewId ?? r.review_id ?? r.id,
        authorName: r.authorName ?? r.reviewer?.displayName ?? r.author_name,
        authorPhoto: r.authorPhoto ?? r.reviewer?.profilePhotoUrl ?? r.author_photo,
        rating: r.rating ?? r.starRating ?? r.star_rating,
        comment: r.comment,
        reply: r.reply ?? r.reviewReply?.comment ?? r.review_reply,
        createTime: r.createTime ?? r.create_time ?? r.review_time,
        updateTime: r.updateTime ?? r.update_time
      }
    });
    if (res.ok) {
      ok++;
      if (res.clientId) touchedClients.add(res.clientId);
      // Aviso de reseña negativa: solo en reseñas NUEVAS con rating <= 3.
      if (res.created && (res.rating ?? 5) <= 3 && res.clientId) {
        await handleNegativeReview({
          workspaceId,
          clientId: res.clientId,
          clientName: res.clientName ?? "",
          clientEmails: res.clientEmails ?? null,
          rating: res.rating ?? 1,
          authorName: res.authorName ?? "",
          comment: res.comment ?? "",
          tone: res.tone ?? "empático y profesional"
        }).catch(() => {});
      }
      // Auto-respuesta de reseñas NUEVAS si el cliente lo tiene activado.
      // Por seguridad solo auto-publicamos POSITIVAS (>=4★); las negativas
      // se dejan para revisión manual (ya se avisa con handleNegativeReview).
      if (res.created && res.clientId) {
        try {
          const client = await prisma.gmbClient.findUnique({ where: { id: res.clientId } });
          const rating = res.rating ?? 5;
          if (client && client.autoReply === "auto" && rating >= 4 && (res.comment ?? "").trim()) {
            const tone = client.tone === "custom" && client.customTone ? client.customTone : client.tone;
            const reply = await generateReviewReply({
              workspaceId,
              businessName: client.name,
              tone,
              rating,
              comment: res.comment ?? ""
            });
            const reviewId = String(r.reviewId ?? r.review_id ?? r.id ?? "");
            if (reply && reviewId && client.accountId && client.locationId) {
              const pub = await publishReplyViaMake({
                workspaceId,
                accountId: client.accountId,
                locationId: client.locationId,
                reviewId,
                reply
              });
              await logGmbActivity({
                workspaceId,
                clientId: client.id,
                actionType: "auto_reply",
                description: pub.sentToGoogle
                  ? `Auto-respuesta publicada a reseña ${rating}★ de ${res.authorName ?? "anónimo"}.`
                  : `Auto-respuesta generada (no publicada: ${pub.error ?? "webhook de Make no configurado"}).`
              });
            }
          }
        } catch (e) {
          console.warn("[gmb] auto-reply falló:", (e as Error).message);
        }
      }
    } else {
      failed++;
    }
  }
  for (const cid of touchedClients) await recomputeClientStats(cid);

  return NextResponse.json({ ok: true, inserted: ok, failed });
}
