/** GET / PATCH / DELETE /api/v1/gmb/shield/watches/[id] */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { placeFrom } from "@/lib/gmb/fake-reviews/core";
import { placeSchema } from "@/lib/gmb/fake-reviews/schemas";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const w = await prisma.gmbReviewWatch.findFirst({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!w) throw new ApiError(404, "not_found", "Vigilancia no encontrada");
  const { knownIds, compState, lockedUntil, ...rest } = w;
  return NextResponse.json({ watch: rest });
});

const patch = z.object({
  enabled: z.boolean().optional(),
  competitors: z.array(placeSchema).max(5).optional(),
  frequencyHours: z.number().int().min(6).max(168).optional(),
  deepCheck: z.boolean().optional(),
  aiCheck: z.boolean().optional(),
  emails: z.string().max(500).optional(),
  whatsapp: z.string().max(40).optional(),
  monthlyReport: z.boolean().optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  const p = patch.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new ApiError(400, "validation_error", p.error.issues[0]?.message ?? p.error.message);
  const { competitors, ...rest } = p.data;
  const r = await prisma.gmbReviewWatch.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId },
    data: { ...rest, ...(competitors ? { competitors: competitors.map(placeFrom) as any } : {}), ...(rest.enabled ? { nextRunAt: new Date() } : {}) }
  });
  if (!r.count) throw new ApiError(404, "not_found", "Vigilancia no encontrada");
  return NextResponse.json({ ok: true });
});

export const DELETE = withApi({ scope: "*", rate: "destructive" }, async (_req, { params, api }) => {
  const r = await prisma.gmbReviewWatch.deleteMany({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!r.count) throw new ApiError(404, "not_found", "Vigilancia no encontrada");
  return NextResponse.json({ ok: true });
});
