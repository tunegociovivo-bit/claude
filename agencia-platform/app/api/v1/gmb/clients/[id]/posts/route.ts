/**
 * GET    /api/v1/gmb/clients/[id]/posts → publicaciones (borradores/programadas)
 * POST   /api/v1/gmb/clients/[id]/posts → { title?, content, cta?, imageUrl?, scheduledAt? }
 * DELETE /api/v1/gmb/clients/[id]/posts?postId=... → elimina
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
  const posts = await prisma.gmbPost.findMany({
    where: { clientId: params.id },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }]
  });
  return NextResponse.json({ posts });
});

const createSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.string().min(1).max(4000),
  cta: z.string().max(200).optional(),
  imageUrl: z.string().url().max(2000).optional().or(z.literal("")),
  scheduledAt: z.string().datetime().optional()
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  await ensureClient(params.id, api.workspaceId);
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const scheduledAt = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null;
  const post = await prisma.gmbPost.create({
    data: {
      workspaceId: api.workspaceId,
      clientId: params.id,
      title: parsed.data.title ?? "",
      content: parsed.data.content,
      cta: parsed.data.cta ?? "",
      imageUrl: parsed.data.imageUrl || null,
      scheduledAt,
      status: scheduledAt ? "scheduled" : "draft",
      createdById: api.userId ?? null
    }
  });
  return NextResponse.json({ post });
});

export const DELETE = withApi({ scope: "*" }, async (req, { params, api }) => {
  await ensureClient(params.id, api.workspaceId);
  const postId = new URL(req.url).searchParams.get("postId") ?? "";
  await prisma.gmbPost.deleteMany({ where: { id: postId, clientId: params.id } });
  return NextResponse.json({ ok: true });
});
