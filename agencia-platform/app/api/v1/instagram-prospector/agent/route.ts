import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { withApi } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const resultSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["COMPLETED", "FAILED"]),
  leads: z.array(z.record(z.any())).optional().default([]),
  skipped: z.array(z.string()).optional().default([]),
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

export const GET = withApi({ scope: "*", rate: "admin" }, async (req: NextRequest, { api }) => {
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

  const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
  await prisma.instagramProspectorJob.updateMany({
    where: { workspaceId: api.workspaceId, status: "RUNNING", startedAt: { lt: staleBefore } },
    data: { status: "QUEUED", startedAt: null, claimedByAgentKey: null, error: "Reintentada tras perder el agente anterior" }
  });

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
  return NextResponse.json({ job: { id: job.id, config: job.config } });
});

export const PATCH = withApi({ scope: "*", rate: "admin" }, async (req: NextRequest, { api }) => {
  await requireAdmin(api);
  const { agentKey } = readAgentHeaders(req);
  if (!agentKey) throw new ApiError(400, "missing_agent", "Falta x-hub-instagram-agent");
  const parsed = resultSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const current = await prisma.instagramProspectorJob.findFirst({
    where: { id: parsed.data.id, workspaceId: api.workspaceId, claimedByAgentKey: agentKey }
  });
  if (!current) throw new ApiError(404, "not_found", "Job de Instagram no encontrado para este agente");

  const result = {
    mode: "internal_browser_agent",
    leads: parsed.data.leads,
    skipped: parsed.data.skipped,
    notice: parsed.data.notice || "Resultados recogidos por agente interno de Instagram."
  };
  await prisma.instagramProspectorJob.update({
    where: { id: current.id },
    data: {
      status: parsed.data.status,
      result,
      error: parsed.data.status === "FAILED" ? (parsed.data.error || "Error del agente interno").slice(0, 2000) : null,
      finishedAt: new Date()
    }
  });
  return NextResponse.json({ ok: true });
});
