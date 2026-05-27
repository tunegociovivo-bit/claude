/**
 * GET    /api/v1/gmb/clients/[id]/reply-templates → plantillas (de la ficha + globales)
 * POST   /api/v1/gmb/clients/[id]/reply-templates → { name, content, type? }
 * DELETE /api/v1/gmb/clients/[id]/reply-templates?templateId=... → elimina
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

async function ensureClient(id: string, workspaceId: string) {
  const c = await prisma.gmbClient.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!c) throw new ApiError(404, "not_found", "Ficha no encontrada");
}

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await ensureClient(params.id, api.workspaceId);
  const items = await prisma.gmbReplyTemplate.findMany({
    where: { workspaceId: api.workspaceId, OR: [{ clientId: params.id }, { clientId: null }] },
    orderBy: { createdAt: "desc" }
  });
  return NextResponse.json({ items });
});

const createSchema = z.object({
  name: z.string().min(1).max(120),
  content: z.string().min(1).max(4000),
  type: z.enum(["positive", "neutral", "negative"]).optional(),
  global: z.boolean().optional()
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  await ensureClient(params.id, api.workspaceId);
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const item = await prisma.gmbReplyTemplate.create({
    data: {
      workspaceId: api.workspaceId,
      clientId: parsed.data.global ? null : params.id,
      name: parsed.data.name,
      content: parsed.data.content,
      type: parsed.data.type ?? "positive"
    }
  });
  return NextResponse.json({ item });
});

export const DELETE = withApi({ scope: "*" }, async (req, { params, api }) => {
  await ensureClient(params.id, api.workspaceId);
  const templateId = new URL(req.url).searchParams.get("templateId") ?? "";
  await prisma.gmbReplyTemplate.deleteMany({ where: { id: templateId, workspaceId: api.workspaceId } });
  return NextResponse.json({ ok: true });
});
