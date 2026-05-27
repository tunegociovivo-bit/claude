/**
 * GET    /api/v1/admin/sonia-knowledge → entradas de conocimiento de Sonia
 * POST   /api/v1/admin/sonia-knowledge → añade texto { title, content }
 * DELETE /api/v1/admin/sonia-knowledge?id=... → elimina (y su índice)
 *
 * El conocimiento se indexa para búsqueda semántica; el chat lo consulta con
 * la tool search_sonia_knowledge.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { indexEntity, deleteEntityIndex } from "@/lib/search/embeddings";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "admin" }, async (_req, { api }) => {
  const items = await prisma.soniaKnowledge.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, sourceType: true, fileName: true, content: true, createdAt: true }
  });
  return NextResponse.json({
    items: items.map((i) => ({
      id: i.id,
      title: i.title,
      sourceType: i.sourceType,
      fileName: i.fileName,
      preview: i.content.slice(0, 200),
      chars: i.content.length,
      createdAt: i.createdAt
    }))
  });
});

const schema = z.object({ title: z.string().min(1).max(200), content: z.string().min(1).max(100000) });

export const POST = withApi({ scope: "admin" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const entry = await prisma.soniaKnowledge.create({
    data: {
      workspaceId: api.workspaceId,
      title: parsed.data.title,
      content: parsed.data.content,
      sourceType: "text",
      createdById: api.userId ?? null
    }
  });
  await indexEntity({
    workspaceId: api.workspaceId,
    entityType: "SONIA_KNOWLEDGE",
    entityId: entry.id,
    text: `${entry.title}\n\n${entry.content}`
  }).catch(() => {});
  return NextResponse.json({ id: entry.id });
});

export const DELETE = withApi({ scope: "admin" }, async (req, { api }) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  await prisma.soniaKnowledge.deleteMany({ where: { id, workspaceId: api.workspaceId } });
  await deleteEntityIndex("SONIA_KNOWLEDGE", id).catch(() => {});
  return NextResponse.json({ ok: true });
});
