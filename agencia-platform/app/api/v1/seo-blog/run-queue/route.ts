import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { runSeoBlogTick } from "@/lib/seo-blog/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Procesa la cola ahora (botón del panel). */
export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireSeoBlogAccess(api);
  const r = await runSeoBlogTick(120_000);
  const pending = await prisma.seoBlogPost.count({ where: { workspaceId: api.workspaceId, status: { in: ["en_cola", "generando", "aprobada"] } } });
  return NextResponse.json({ ...r, pending });
});
