/**
 * GET    /api/v1/gmb/clients/[id]/photos → fotos de la ficha
 * POST   /api/v1/gmb/clients/[id]/photos → { url, type?, caption? }
 * DELETE /api/v1/gmb/clients/[id]/photos?photoId=... → elimina
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
  const photos = await prisma.gmbPhoto.findMany({ where: { clientId: params.id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ photos });
});

const createSchema = z.object({
  url: z.string().url().max(2000),
  type: z.string().max(40).optional(),
  caption: z.string().max(300).optional()
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  await ensureClient(params.id, api.workspaceId);
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const photo = await prisma.gmbPhoto.create({
    data: {
      workspaceId: api.workspaceId,
      clientId: params.id,
      url: parsed.data.url,
      type: parsed.data.type ?? "general",
      caption: parsed.data.caption ?? ""
    }
  });
  return NextResponse.json({ photo });
});

export const DELETE = withApi({ scope: "*" }, async (req, { params, api }) => {
  await ensureClient(params.id, api.workspaceId);
  const photoId = new URL(req.url).searchParams.get("photoId") ?? "";
  await prisma.gmbPhoto.deleteMany({ where: { id: photoId, clientId: params.id } });
  return NextResponse.json({ ok: true });
});
