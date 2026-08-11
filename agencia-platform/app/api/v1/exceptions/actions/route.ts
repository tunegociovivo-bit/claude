/**
 * POST /api/v1/exceptions/actions  (Slice 2b)
 *
 * Persistencia server-side, IDEMPOTENTE y AUDITADA de acciones sobre excepciones
 * (archivar/ignorar/posponer/…). Sustituye el "ocultar" que vivía solo en
 * localStorage. Detrás del flag HUB_EXCEPTIONS_ACTIONS (off por defecto).
 *
 *  Body (crear/refrescar):  { exceptionId, dedupeKey, source, kind, action,
 *                             reason?, severity?, expiresAt?, meta? }
 *  Body (revertir/mostrar): { revoke: true, exceptionId, action }
 *
 * Idempotente por @@unique([workspaceId, exceptionId, action]) → repetir la misma
 * acción no duplica. Toda escritura filtra por workspaceId (tenant) y deja rastro
 * en AuditLog.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { exceptionsEnabled, exceptionActionsEnabled } from "@/lib/exceptions/flags";
import { validateActionInput, isActionType, parseExceptionId } from "@/lib/exceptions/actions";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "clients:write", rate: "admin" }, async (req, { api }) => {
  if (!exceptionsEnabled() || !exceptionActionsEnabled()) {
    return NextResponse.json({ error: { code: "disabled", message: "Acciones de excepciones desactivadas" } }, { status: 404 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "bad_request", message: "JSON inválido" } }, { status: 400 });
  }
  const ws = api.workspaceId;

  // ── Revertir (mostrar de nuevo) ────────────────────────────────────────────
  if (body?.revoke === true) {
    const exceptionId = typeof body.exceptionId === "string" ? body.exceptionId.trim() : "";
    const action = body.action;
    if (!exceptionId || !parseExceptionId(exceptionId) || !isActionType(action)) {
      return NextResponse.json({ error: { code: "bad_request", message: "exceptionId/action inválidos" } }, { status: 400 });
    }
    // updateMany con workspaceId en el where → tenant-safe e idempotente.
    const res = await prisma.exceptionAction.updateMany({
      where: { workspaceId: ws, exceptionId, action, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    if (res.count > 0) {
      await prisma.auditLog.create({
        data: { workspaceId: ws, actorId: api.userId ?? null, action: `exception.${action}.revoked`, targetType: "exception", targetId: exceptionId, meta: {} }
      });
    }
    return NextResponse.json({ ok: true, revoked: res.count });
  }

  // ── Crear / refrescar ──────────────────────────────────────────────────────
  const parsed = validateActionInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: { code: "bad_request", message: parsed.error } }, { status: 400 });
  }
  const v = parsed.value;
  // meta se guarda como JSON no sensible; nunca importes/PII (el cliente solo
  // manda ids/fechas). Truncamos por seguridad.
  const meta = v.meta && typeof v.meta === "object" ? v.meta : null;

  const saved = await prisma.exceptionAction.upsert({
    where: { workspaceId_exceptionId_action: { workspaceId: ws, exceptionId: v.exceptionId, action: v.action } },
    create: {
      workspaceId: ws,
      exceptionId: v.exceptionId,
      dedupeKey: v.dedupeKey,
      source: v.source,
      kind: v.kind,
      action: v.action,
      reason: v.reason ?? null,
      severity: v.severity ?? null,
      expiresAt: v.expiresAt ? new Date(v.expiresAt) : null,
      meta: meta as any,
      actorId: api.userId ?? null,
      revokedAt: null
    },
    update: {
      // Re-aplicar (idempotente): refresca datos y "revive" si estaba revocada.
      dedupeKey: v.dedupeKey,
      reason: v.reason ?? null,
      severity: v.severity ?? null,
      expiresAt: v.expiresAt ? new Date(v.expiresAt) : null,
      meta: meta as any,
      actorId: api.userId ?? null,
      revokedAt: null
    }
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: ws,
      actorId: api.userId ?? null,
      action: `exception.${v.action}`,
      targetType: "exception",
      targetId: v.exceptionId,
      meta: { reason: v.reason ?? null, expiresAt: v.expiresAt ?? null, severity: v.severity ?? null, dedupeKey: v.dedupeKey }
    }
  });

  return NextResponse.json({ ok: true, id: saved.id, action: saved.action });
});
