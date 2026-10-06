import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { runSeoBlogTick } from "@/lib/seo-blog/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Procesa ahora la cola de ESTE negocio (botón del panel). El resto lo hace el planificador cada 2 min. */
export const POST = withApi({ module: "seo", rate: "ai" }, async (_req, { api }) => {
  const r = await runSeoBlogTick(120_000, { workspaceId: api.workspaceId });
  const pending = await prisma.seoBlogPost.count({ where: { workspaceId: api.workspaceId, status: { in: ["en_cola", "generando", "aprobada"] } } });
  return NextResponse.json({ ...r, pending });
});
