/** PATCH/DELETE /api/v1/gmb/review-funnels/[id] — edita o elimina un embudo de reseñas. Tenant-scoped. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  ownerEmail: z.string().email().max(200).or(z.literal("")).optional(),
  headline: z.string().max(200).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logoUrl: z.string().url().max(500).or(z.literal("")).optional(),
  active: z.boolean().optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", "Datos no válidos.");
  const r = await prisma.gmbReviewFunnel.updateMany({ where: { id: (params as any).id, workspaceId: api.workspaceId }, data: parsed.data });
  if (!r.count) throw new ApiError(404, "not_found", "Embudo no encontrado");
  return NextResponse.json({ ok: true });
});

export const DELETE = withApi({ scope: "*", rate: "destructive" }, async (_req, { params, api }) => {
  const id = (params as any).id as string;
  const r = await prisma.gmbReviewFunnel.deleteMany({ where: { id, workspaceId: api.workspaceId } });
  if (!r.count) throw new ApiError(404, "not_found", "Embudo no encontrado");
  await prisma.gmbReviewFunnelEvent.deleteMany({ where: { funnelId: id, workspaceId: api.workspaceId } });
  await prisma.gmbReviewFunnelFeedback.deleteMany({ where: { funnelId: id, workspaceId: api.workspaceId } });
  return NextResponse.json({ ok: true });
});
