/**
 * PATCH /api/v1/gmb/alerts/[id] — ack / resolve / reopen / asignar. Tenant-scoped (guard antes de
 * escribir) + auditoría de actor. Idempotencia por transición de estado.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { computeAlertTransition, type AlertStatus, type AlertCommand } from "@/lib/gmb/alerts";

export const dynamic = "force-dynamic";

const schema = z.object({ command: z.enum(["ack", "resolve", "reopen"]).optional(), assignTo: z.string().max(120).nullable().optional() });

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  const alert = await prisma.gmbAlert.findFirst({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!alert) throw new ApiError(404, "not_found", "Alerta no encontrada");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const data: any = {};
  if (parsed.data.assignTo !== undefined) data.assignedTo = parsed.data.assignTo;
  if (parsed.data.command) {
    const t = computeAlertTransition(alert.status as AlertStatus, parsed.data.command as AlertCommand);
    if (!t.ok) throw new ApiError(409, "invalid_transition", t.error ?? "Transición inválida");
    data.status = t.next;
    if (parsed.data.command === "ack") { data.ackedById = api.userId ?? null; data.ackedAt = new Date(); }
    if (parsed.data.command === "resolve") { data.resolvedById = api.userId ?? null; data.resolvedAt = new Date(); }
  }
  if (Object.keys(data).length === 0) throw new ApiError(400, "no_op", "Indica command o assignTo");
  await prisma.gmbAlert.updateMany({ where: { id: alert.id, workspaceId: api.workspaceId }, data });
  return NextResponse.json({ ok: true, id: alert.id, status: data.status ?? alert.status });
});
