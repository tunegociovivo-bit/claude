import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { withApi } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { supportsAudienceDiscovery, MIN_INSTAGRAM_AGENT_VERSION } from "@/lib/instagram-prospector/agent-version";

export const dynamic = "force-dynamic";

const schema = z.object({
  sourceType: z.enum(["followers", "likers", "comments", "hashtag", "location"]),
  target: z.string().trim().min(2).max(5000),
  limit: z.number().int().min(1).max(1000),
  country: z.string().trim().max(80).default("Espana"),
  requiredSignalCount: z.number().int().min(1).max(8).default(2),
  requireIntentSignal: z.boolean().default(true),
  requireContact: z.boolean().default(true),
  emailKeywords: z.string().max(2000).default(""),
  intentSignals: z.string().max(4000).default(""),
  negativeFilters: z.string().max(4000).default("")
});

export const POST = withApi({ scope: "*", admin: true, rate: "admin" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const agents = await prisma.instagramProspectorAgent.findMany({
    where: { workspaceId: api.workspaceId, lastHeartbeatAt: { gte: new Date(Date.now() - 2 * 60 * 1000) } },
    select: { version: true }
  });
  const onlineAgents = agents.filter((agent) => supportsAudienceDiscovery(agent.version)).length;
  if (!onlineAgents) throw new ApiError(409, "agent_required", agents.length
    ? `Actualiza la extension a ${MIN_INSTAGRAM_AGENT_VERSION} o posterior. La version conectada no recopila audiencias.`
    : "No hay una extension conectada capaz de recopilar audiencias. Conecta Chrome y vuelve a intentarlo.");
  const job = await prisma.instagramProspectorJob.create({
    data: {
      workspaceId: api.workspaceId,
      userId: api.userId,
      config: parsed.data
    }
  });
  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    onlineAgents,
    notice: onlineAgents
      ? "Busqueda encolada para el agente interno de Instagram."
      : "Busqueda encolada. No hay ningun agente interno de Instagram conectado ahora mismo."
  }, { status: 202 });
});
