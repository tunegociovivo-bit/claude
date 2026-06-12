/**
 * Difusión segmentada del inbox.
 *
 *  POST { preview:true, segment }            → { count }   (previsualiza)
 *  POST { text, segment }                    → crea la difusión y la encola
 *                                              espaciada (anti-baneo)
 *  GET                                        → últimas difusiones con progreso
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { createBroadcast, previewSegment } from "@/lib/leads/broadcast";

export const dynamic = "force-dynamic";

const segmentSchema = z.object({
  classifications: z.array(z.string()).optional(),
  statuses: z.array(z.string()).optional(),
  priorities: z.array(z.string()).optional(),
  includeArchived: z.boolean().optional()
});

const schema = z.object({
  preview: z.boolean().optional(),
  text: z.string().max(2000).optional(),
  segment: segmentSchema.default({})
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const { preview, text, segment } = parsed.data;

  if (preview) {
    const count = await previewSegment(api.workspaceId, segment);
    return NextResponse.json({ count });
  }

  if (!text || !text.trim()) throw new ApiError(400, "empty_text", "Escribe el mensaje de la difusión.");

  try {
    const res = await createBroadcast({ workspaceId: api.workspaceId, text, segment });
    return NextResponse.json({
      ok: true,
      broadcastId: res.broadcastId,
      total: res.total,
      firstAt: res.firstAt?.toISOString() ?? null,
      lastAt: res.lastAt?.toISOString() ?? null
    });
  } catch (e: any) {
    throw new ApiError(409, "broadcast_failed", e?.message ?? "No se pudo crear la difusión.");
  }
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const items = await prisma.leadBroadcast.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      body: true,
      total: true,
      sentCount: true,
      failedCount: true,
      status: true,
      createdAt: true
    }
  });
  return NextResponse.json({
    items: items.map((b) => ({
      ...b,
      createdAt: b.createdAt.toISOString(),
      pending: Math.max(0, b.total - b.sentCount - b.failedCount)
    }))
  });
});
