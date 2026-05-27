/**
 * POST /api/v1/gmb/ai-reply
 * Body: { clientId, reviewId } o { businessName, tone, rating, comment }
 * Devuelve { reply } generada por OpenAI (no la guarda).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { generateReviewReply } from "@/lib/integrations/gmb-hub";

export const dynamic = "force-dynamic";

const schema = z.object({
  clientId: z.string().optional(),
  reviewId: z.string().optional(),
  businessName: z.string().optional(),
  tone: z.string().optional(),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().optional()
});

export const POST = withApi({ scope: "ai", rate: "ai" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const d = parsed.data;

  let businessName = d.businessName ?? "";
  let tone = d.tone ?? "profesional";
  let rating = d.rating ?? 5;
  let comment = d.comment ?? "";

  // Si vienen clientId+reviewId, resolvemos de la BD.
  if (d.clientId && d.reviewId) {
    const client = await prisma.gmbClient.findFirst({
      where: { id: d.clientId, workspaceId: api.workspaceId },
      select: { name: true, tone: true, customTone: true }
    });
    if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
    const review = await prisma.gmbReview.findFirst({
      where: { clientId: d.clientId, reviewId: d.reviewId },
      select: { rating: true, comment: true }
    });
    if (!review) throw new ApiError(404, "not_found", "Reseña no encontrada");
    businessName = client.name;
    tone = client.tone === "custom" && client.customTone ? client.customTone : client.tone;
    rating = review.rating || 5;
    comment = review.comment ?? "";
  }

  if (!businessName) throw new ApiError(400, "missing_business", "Falta el negocio o clientId+reviewId");

  try {
    const reply = await generateReviewReply({ workspaceId: api.workspaceId, businessName, tone, rating, comment });
    return NextResponse.json({ reply });
  } catch (e: any) {
    throw new ApiError(502, "ai_error", String(e?.message ?? e));
  }
});
