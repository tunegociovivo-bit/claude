/**
 * POST /api/v1/gmb/clients/[id]/reviews/auto-reply  { mode?: "positive"|"negative"|"both", limit?: number }
 * Responde AHORA con IA (y publica en Google) las reseñas sin responder que cubre el modo
 * (por defecto, el de la ficha). Máx. 25 por llamada, de la más reciente a la más antigua.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { autoReplyToReview, modeMatches, normalizeReplyMode } from "@/lib/gmb/review-automation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({ mode: z.enum(["positive", "negative", "both"]).optional(), limit: z.number().int().min(1).max(25).optional() });

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await prisma.gmbClient.findFirst({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const b = schema.safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new ApiError(400, "validation_error", b.error.message);
  const mode = b.data.mode ?? normalizeReplyMode(client.autoReply);
  if (mode === "manual") return NextResponse.json({ ok: false, message: "La ficha está en modo manual: elige qué reseñas responder." });
  const pending = await prisma.gmbReview.findMany({
    where: { workspaceId: api.workspaceId, clientId: client.id, reviewReply: null },
    orderBy: { reviewTime: "desc" },
    take: 200,
    select: { reviewId: true, rating: true, comment: true, authorName: true }
  });
  const todo = pending.filter((r) => modeMatches(mode, r.rating)).slice(0, b.data.limit ?? 25);
  let ok = 0;
  const errors: string[] = [];
  for (const r of todo) {
    const res = await autoReplyToReview(client, { reviewId: r.reviewId, rating: r.rating, comment: r.comment ?? "", authorName: r.authorName, hasReply: false });
    if (res.ok) ok++;
    else if (res.error) errors.push(`${r.authorName}: ${res.error}`);
  }
  const remaining = pending.filter((r) => modeMatches(mode, r.rating)).length - ok;
  return NextResponse.json({ ok: true, replied: ok, failed: errors.length, errors: errors.slice(0, 5), remaining: Math.max(0, remaining) });
});
