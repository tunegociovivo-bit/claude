import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { stepPost } from "@/lib/seo-blog/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Ejecuta UN paso del pipeline del post (la UI lo llama en bucle para ver el progreso en directo). */
export const POST = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await requireSeoBlogAccess(api);
  const p = await prisma.seoBlogPost.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true } });
  if (!p) throw new ApiError(404, "not_found", "Post no encontrado");
  return NextResponse.json(await stepPost(api.workspaceId, p.id));
});
