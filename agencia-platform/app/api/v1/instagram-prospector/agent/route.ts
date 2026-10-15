import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { withApi } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { supportsAudienceDiscovery } from "@/lib/instagram-prospector/agent-version";

export const dynamic = "force-dynamic";

const resultSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["RUNNING", "COMPLETED", "FAILED"]),
  leads: z.array(z.record(z.any())).max(1000).optional(),
  skipped: z.array(z.string().max(2000)).max(2000).optional(),
  candidates: z.array(z.record(z.any())).max(1000).optional(),
  cursor: z.number().int().min(0).max(1000).optional(),
  notice: z.string().optional(),
  error: z.string().optional()
});

function readAgentHeaders(req: NextRequest) {
  return {
    agentKey: String(req.headers.get("x-hub-instagram-agent") || req.headers.get("x-hub-browser-agent") || "").trim().slice(0, 100),
    label: String(req.headers.get("x-hub-instagram-agent-label") || req.headers.get("x-hub-browser-agent-label") || "Instagram Browser Agent").trim().slice(0, 100),
    version: String(req.headers.get("x-hub-extension-version") || "").trim().slice(0, 30) || null
  };
}

export const GET = withApi({ scope: "*" }, async (req: NextRequest, { api }) => {
  await requireAdmin(api);
  const { agentKey, label, version } = readAgentHeaders(req);
  if (!agentKey) throw new ApiError(400, "missing_agent", "Falta x-hub-instagram-agent");
  await prisma.instagramProspectorAgent.upsert({
    where: { workspaceId_agentKey: { workspaceId: api.workspaceId, agentKey } },
    create: { workspaceId: api.workspaceId, agentKey, label, version, lastHeartbeatAt: new Date() },
    update: { label, version, lastHeartbeatAt: new Date() }
  });
  if (req.nextUrl.searchParams.get("registerOnly") === "1") {
    return NextResponse.json({ ok: true, registered: true });
  }
  if (!supportsAudienceDiscovery(version)) return NextResponse.json({ job: null, updateRequired: true });

  const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
  await prisma.instagramProspectorJob.updateMany({
    where: { workspaceId: api.workspaceId, status: "RUNNING", updatedAt: { lt: staleBefore } },
    data: { status: "QUEUED", startedAt: null, claimedByAgentKey: null, error: "Reintentada tras perder el agente anterior" }
  });

  const resumed = await prisma.instagramProspectorJob.findFirst({
    where: { workspaceId: api.workspaceId, status: "RUNNING", claimedByAgentKey: agentKey },
    orderBy: { createdAt: "asc" }
  });
  if (resumed) return NextResponse.json({ job: { id: resumed.id, config: resumed.config, result: resumed.result } });
  const job = await prisma.instagramProspectorJob.findFirst({
    where: { workspaceId: api.workspaceId, status: "QUEUED" },
    orderBy: { createdAt: "asc" }
  });
  if (!job) return NextResponse.json({ job: null });
  const claimed = await prisma.instagramProspectorJob.updateMany({
    where: { id: job.id, workspaceId: api.workspaceId, status: "QUEUED" },
    data: { status: "RUNNING", claimedByAgentKey: agentKey, startedAt: new Date(), error: null }
  });
  if (!claimed.count) return NextResponse.json({ job: null });
  return NextResponse.json({ job: { id: job.id, config: job.config, result: job.result } });
});

export const PATCH = withApi({ scope: "*" }, async (req: NextRequest, { api }) => {
  await requireAdmin(api);
  const { agentKey } = readAgentHeaders(req);
  if (!agentKey) throw new ApiError(400, "missing_agent", "Falta x-hub-instagram-agent");
  const parsed = resultSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const current = await prisma.instagramProspectorJob.findFirst({
    where: { id: parsed.data.id, workspaceId: api.workspaceId, claimedByAgentKey: agentKey, status: "RUNNING" }
  });
  if (!current) throw new ApiError(404, "not_found", "Job de Instagram no encontrado para este agente");

  const previous = (current.result && typeof current.result === "object" && !Array.isArray(current.result)) ? current.result : {};
  const result = {
    ...previous,
    mode: "internal_browser_agent",
    leads: parsed.data.leads ?? previous.leads ?? [],
    skipped: parsed.data.skipped ?? previous.skipped ?? [],
    ...(parsed.data.candidates ? { candidates: parsed.data.candidates } : {}),
    ...(parsed.data.cursor !== undefined ? { cursor: parsed.data.cursor } : {}),
    notice: parsed.data.notice || "Resultados recogidos por agente interno de Instagram."
  };
  const saved = await prisma.instagramProspectorJob.updateMany({
    where: { id: current.id, workspaceId: api.workspaceId, claimedByAgentKey: agentKey, status: "RUNNING" },
    data: {
      status: parsed.data.status,
      result,
      error: parsed.data.status === "FAILED" ? (parsed.data.error || "Error del agente interno").slice(0, 2000) : null,
      finishedAt: parsed.data.status === "RUNNING" ? null : new Date()
    }
  });
  if (!saved.count) throw new ApiError(409, "job_changed", "La busqueda ya no pertenece a este agente");
  await prisma.instagramProspectorAgent.updateMany({
    where: { workspaceId: api.workspaceId, agentKey }, data: { lastHeartbeatAt: new Date() }
  });
  return NextResponse.json({ ok: true });
});
