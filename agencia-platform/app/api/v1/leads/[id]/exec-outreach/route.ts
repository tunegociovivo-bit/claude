/**
 * Secuencia multicanal de contacto a directivo de un lead.
 *
 *  POST { email?, directorName? }  → inicia/reinicia la secuencia
 *  GET                             → estado actual
 *  DELETE                          → detiene la secuencia
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { startExecOutreach, stopExecOutreach } from "@/lib/leads/exec-outreach";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email().optional(),
  directorName: z.string().max(120).optional()
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const lead = await prisma.lead.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true } });
  if (!lead) throw new ApiError(404, "not_found", "Lead no encontrado");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  await startExecOutreach({
    workspaceId: api.workspaceId,
    leadId: lead.id,
    email: parsed.data.email ?? null,
    directorName: parsed.data.directorName ?? null
  });
  return NextResponse.json({ ok: true, status: "active" });
});

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const row = await prisma.leadExecOutreach.findUnique({
    where: { workspaceId_leadId: { workspaceId: api.workspaceId, leadId: params.id } },
    select: { email: true, directorName: true, step: true, status: true, nextAt: true, log: true }
  });
  if (!row) return NextResponse.json({ active: false });
  return NextResponse.json({
    active: row.status === "active",
    status: row.status,
    step: row.step,
    email: row.email,
    directorName: row.directorName,
    nextAt: row.nextAt.toISOString(),
    log: Array.isArray(row.log) ? row.log : []
  });
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await stopExecOutreach(api.workspaceId, params.id);
  return NextResponse.json({ ok: true, status: "stopped" });
});
