/**
 * Transición de una ACCIÓN de la cola (aprobación / ejecución segura / descarte).
 *  PATCH { command } → prepare|request_approval|approve|execute|complete|fail|dismiss|reopen.
 * Reglas: las acciones EXTERNAS sensibles requieren pasar por needs_approval y aprobación humana
 * (actor). La ejecución "segura" real de efectos internos se hará por fase; aquí se registra estado,
 * aprobador y auditoría. Tenant-scoped (guard antes de escribir).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { computeActionTransition, type ActionStatus, type ActionCommand } from "@/lib/gmb/actions";

export const dynamic = "force-dynamic";

const schema = z.object({
  command: z.enum(["prepare", "request_approval", "approve", "execute", "complete", "fail", "dismiss", "reopen"]),
  note: z.string().max(500).optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  // Guard de tenant: la acción debe ser del workspace.
  const action = await prisma.gmbAction.findFirst({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!action) throw new ApiError(404, "not_found", "Acción no encontrada");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const t = computeActionTransition(
    { status: action.status as ActionStatus, external: action.external, requiresApproval: action.requiresApproval },
    parsed.data.command as ActionCommand,
    { actorId: api.userId }
  );
  if (!t.ok) throw new ApiError(409, "invalid_transition", t.error ?? "Transición inválida");

  const data: any = { status: t.next };
  if (parsed.data.command === "approve") { data.approvedById = api.userId ?? null; data.approvedAt = new Date(); }
  if (parsed.data.command === "fail") data.lastError = parsed.data.note ?? "error";
  if (parsed.data.command === "complete") data.result = { note: parsed.data.note ?? "completada", at: new Date().toISOString() };

  await prisma.gmbAction.updateMany({ where: { id: action.id, workspaceId: api.workspaceId }, data });
  return NextResponse.json({ ok: true, id: action.id, status: t.next });
});
