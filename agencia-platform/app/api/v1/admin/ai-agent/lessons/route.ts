/**
 * Admin: ver / crear / borrar lecciones de Sonia.
 *
 * GET    → lista todas las lecciones del workspace (filtrable por scope).
 * POST   → admin crea una lección manualmente.
 * DELETE → borra (soft: marca isActive=false) una lección por id.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { recordLesson } from "@/lib/ai/nv-ia/lessons";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? undefined;
  const items = await prisma.aiAgentLesson.findMany({
    where: {
      workspaceId: api.workspaceId,
      isActive: true,
      ...(scope ? { scope } : {})
    },
    orderBy: [{ useCount: "desc" }, { createdAt: "desc" }],
    take: 200
  });
  return NextResponse.json({ items });
});

const createSchema = z.object({
  scope: z.string().min(1).max(120),
  lesson: z.string().min(8).max(2000),
  triggerPattern: z.string().max(500).optional().nullable()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const result = await recordLesson({
    workspaceId: api.workspaceId,
    scope: parsed.data.scope,
    lesson: parsed.data.lesson,
    triggerPattern: parsed.data.triggerPattern ?? null,
    source: "human"
  });
  return NextResponse.json(result, { status: 201 });
});

export const DELETE = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) throw new ApiError(400, "missing_id", "Falta ?id=");
  const r = await prisma.aiAgentLesson.updateMany({
    where: { id, workspaceId: api.workspaceId },
    data: { isActive: false }
  });
  return NextResponse.json({ ok: true, deactivated: r.count });
});
