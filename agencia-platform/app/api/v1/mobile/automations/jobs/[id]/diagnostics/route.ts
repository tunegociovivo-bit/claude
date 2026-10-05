import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { loadMobileAutomationAccess } from "@/lib/mobile/automation-access";

export const dynamic = "force-dynamic";

const EVENT = "DIAGNOSTIC";
const KEEP = 5;
const schema = z.object({
  error: z.string().max(2000).optional(),
  trace: z.array(z.string().max(1500)).max(60),
  xml: z.string().max(400_000).optional(),
  screenshot: z.string().regex(/^data:image\/(jpeg|png);base64,/).max(700_000).optional()
}).strict();

/**
 * Diagnóstico de un fallo en el móvil: recorrido de pasos, última jerarquía de la
 * pantalla y captura. Sirve para ver exactamente qué veía el móvil al fallar.
 */
export const POST = withApi({ scope: "*", rate: "mobile_worker" }, async (req, { api, params }) => {
  await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", "Diagnóstico no válido.");
  const job = await prisma.mobileAutomationJob.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true } });
  if (!job) throw new ApiError(404, "not_found", "Trabajo no encontrado.");
  await prisma.mobileAutomationJobEvent.create({
    data: { workspaceId: api.workspaceId, jobId: job.id, event: EVENT, actorType: "BROWSER", actorId: api.userId, metadata: parsed.data }
  });
  const old = await prisma.mobileAutomationJobEvent.findMany({
    where: { workspaceId: api.workspaceId, jobId: job.id, event: EVENT },
    orderBy: { createdAt: "desc" }, skip: KEEP, select: { id: true }
  });
  if (old.length) await prisma.mobileAutomationJobEvent.deleteMany({ where: { id: { in: old.map((row) => row.id) } } });
  return NextResponse.json({ ok: true });
});

export const GET = withApi({ scope: "*" }, async (_req, { api, params }) => {
  await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  const rows = await prisma.mobileAutomationJobEvent.findMany({
    where: { workspaceId: api.workspaceId, jobId: params.id, event: EVENT },
    orderBy: { createdAt: "desc" }, take: KEEP, select: { createdAt: true, metadata: true }
  });
  return NextResponse.json({ diagnostics: rows });
});
