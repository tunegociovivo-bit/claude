/**
 * GET  /api/v1/gmb/shield/watches → vigilancias del workspace
 * POST /api/v1/gmb/shield/watches → crea una vigilancia diaria de una ficha (y su competencia)
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { placeFrom } from "@/lib/gmb/fake-reviews/core";
import { placeSchema } from "@/lib/gmb/fake-reviews/schemas";

export const dynamic = "force-dynamic";

const schema = z.object({
  gmbClientId: z.string().max(60).optional().nullable(),
  place: placeSchema,
  competitors: z.array(placeSchema).max(5).default([]),
  frequencyHours: z.number().int().min(6).max(168).default(24),
  deepCheck: z.boolean().default(true),
  aiCheck: z.boolean().default(true),
  emails: z.string().max(500).default(""),
  whatsapp: z.string().max(40).default(""),
  monthlyReport: z.boolean().default(true)
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const rows = await prisma.gmbReviewWatch.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true, name: true, gmbClientId: true, place: true, competitors: true, enabled: true, frequencyHours: true, deepCheck: true, aiCheck: true,
      emails: true, whatsapp: true, monthlyReport: true, history: true, lastRunAt: true, nextRunAt: true, lastError: true, apiCalls: true, createdAt: true
    }
  });
  const open = await prisma.gmbReviewCase.groupBy({ by: ["watchId"], where: { workspaceId: api.workspaceId, status: { in: ["preparada", "denunciada", "rechazada", "apelada"] } }, _count: true });
  const byWatch = new Map(open.map((o) => [o.watchId, o._count]));
  return NextResponse.json({
    watches: rows.map((r) => {
      const h = (r.history as any[] | null) ?? [];
      return { ...r, history: h.slice(-60), openCases: byWatch.get(r.id) ?? 0 };
    })
  });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new ApiError(400, "validation_error", p.error.issues[0]?.message ?? p.error.message);
  const b = p.data;
  if (b.gmbClientId) {
    const c = await prisma.gmbClient.findFirst({ where: { id: b.gmbClientId, workspaceId: api.workspaceId }, select: { id: true } });
    if (!c) throw new ApiError(404, "not_found", "Ficha no encontrada");
  }
  const place = placeFrom(b.place);
  const dup = await prisma.gmbReviewWatch.findFirst({ where: { workspaceId: api.workspaceId, OR: [{ place: { path: ["dataId"], equals: place.dataId || "__" } }, { place: { path: ["placeId"], equals: place.placeId || "__" } }] }, select: { id: true } });
  if (dup) throw new ApiError(409, "conflict", "Esta ficha ya está en vigilancia.");
  const row = await prisma.gmbReviewWatch.create({
    data: {
      workspaceId: api.workspaceId,
      gmbClientId: b.gmbClientId ?? null,
      name: place.title.slice(0, 250),
      place: place as any,
      competitors: b.competitors.map(placeFrom) as any,
      frequencyHours: b.frequencyHours,
      deepCheck: b.deepCheck,
      aiCheck: b.aiCheck,
      emails: b.emails,
      whatsapp: b.whatsapp,
      monthlyReport: b.monthlyReport,
      nextRunAt: new Date(),
      createdById: api.userId ?? null
    },
    select: { id: true }
  });
  return NextResponse.json({ id: row.id });
});
