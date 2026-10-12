import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { withApi } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { runInternalInstagramScan } from "@/lib/instagram-prospector/internal-scan";

export const dynamic = "force-dynamic";

const schema = z.object({
  sourceType: z.enum(["followers", "likers", "comments", "hashtag", "location"]),
  target: z.string().trim().min(2).max(5000),
  limit: z.number().int().min(1).max(1000),
  country: z.string().trim().max(80).default("Espana"),
  requiredSignalCount: z.number().int().min(1).max(8).default(2),
  requireIntentSignal: z.boolean().default(true),
  emailKeywords: z.string().max(2000).default(""),
  intentSignals: z.string().max(4000).default(""),
  negativeFilters: z.string().max(4000).default("")
});

export const POST = withApi({ scope: "*", admin: true, rate: "admin" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const job = await prisma.instagramProspectorJob.create({
    data: {
      workspaceId: api.workspaceId,
      userId: api.userId,
      config: parsed.data
    }
  });
  const onlineSince = new Date(Date.now() - 2 * 60 * 1000);
  const onlineAgents = await prisma.instagramProspectorAgent.count({
    where: { workspaceId: api.workspaceId, lastHeartbeatAt: { gte: onlineSince } }
  });
  if (!onlineAgents) {
    const result = await runInternalInstagramScan(parsed.data);
    await prisma.instagramProspectorJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        result,
        finishedAt: new Date()
      }
    });
    return NextResponse.json({
      jobId: job.id,
      status: "COMPLETED",
      onlineAgents: 1,
      fallbackMode: "internal_public_web",
      result,
      notice: "No habia agente interno conectado. He usado el motor publico propio de la plataforma para esta busqueda."
    }, { status: 202 });
  }
  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    onlineAgents,
    notice: onlineAgents
      ? "Busqueda encolada para el agente interno de Instagram."
      : "Busqueda encolada. No hay ningun agente interno de Instagram conectado ahora mismo."
  }, { status: 202 });
});
