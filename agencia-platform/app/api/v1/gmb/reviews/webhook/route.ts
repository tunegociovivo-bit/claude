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
import { upsertIncomingReview, recomputeClientStats, getGmbConfig } from "@/lib/integrations/gmb-hub";

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
    } else {
      failed++;
    }
  }
  for (const cid of touchedClients) await recomputeClientStats(cid);

  return NextResponse.json({ ok: true, inserted: ok, failed });
}
