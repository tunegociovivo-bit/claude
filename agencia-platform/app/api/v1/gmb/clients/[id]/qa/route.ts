/**
 * GET    /api/v1/gmb/clients/[id]/qa → preguntas y respuestas
 * POST   /api/v1/gmb/clients/[id]/qa → { question, answer }
 * DELETE /api/v1/gmb/clients/[id]/qa?qaId=... → elimina
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
  const items = await prisma.gmbQa.findMany({ where: { clientId: params.id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ items });
});

const createSchema = z.object({ question: z.string().min(1).max(1000), answer: z.string().min(1).max(4000) });

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  await ensureClient(params.id, api.workspaceId);
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const item = await prisma.gmbQa.create({
    data: { workspaceId: api.workspaceId, clientId: params.id, question: parsed.data.question, answer: parsed.data.answer }
  });
  return NextResponse.json({ item });
});

export const DELETE = withApi({ scope: "*" }, async (req, { params, api }) => {
  await ensureClient(params.id, api.workspaceId);
  const qaId = new URL(req.url).searchParams.get("qaId") ?? "";
  await prisma.gmbQa.deleteMany({ where: { id: qaId, clientId: params.id } });
  return NextResponse.json({ ok: true });
});
