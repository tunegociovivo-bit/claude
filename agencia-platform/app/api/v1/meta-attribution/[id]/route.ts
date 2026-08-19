import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { META_LEAD_STAGES, stageDates } from "@/lib/meta/attribution";

const schema = z.object({ status: z.enum(META_LEAD_STAGES), revenueCents: z.number().int().min(0).max(1_000_000_000).optional(), qualityScore: z.number().int().min(0).max(100).nullable().optional(), lossReason: z.string().max(1000).nullable().optional() });
export const PATCH = withApi({}, async (req, { api, params }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null)); if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const existing = await prisma.metaLeadAttribution.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true } });
  if (!existing) throw new ApiError(404, "not_found", "Lead no encontrado");
  const now = new Date(); const item = await prisma.metaLeadAttribution.update({ where: { id: existing.id }, data: { ...parsed.data, ...stageDates(parsed.data.status, now) } });
  return NextResponse.json({ item });
});
