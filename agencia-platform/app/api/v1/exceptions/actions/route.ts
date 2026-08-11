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
import { callerIsAdmin } from "@/lib/api/permissions";
import { exceptionsEnabled, exceptionActionsEnabled } from "@/lib/exceptions/flags";
import { validateActionInput, isActionType, parseExceptionId } from "@/lib/exceptions/actions";

export const dynamic = "force-dynamic";

const META_MAX_BYTES = 4000;

/** Las excepciones de facturación solo las ve/gestiona admin (igual que el GET,
 *  que gatea `includeBilling`). Evita que un no-admin oculte cobros a los admin. */
async function billingGateOk(exceptionId: string, api: any): Promise<boolean> {
  const src = parseExceptionId(exceptionId)?.source;
  if (src !== "invoice") return true;
  return callerIsAdmin(api);
}

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
    if (!(await billingGateOk(exceptionId, api))) {
      return NextResponse.json({ error: { code: "forbidden", message: "Requiere permiso de facturación" } }, { status: 403 });
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
  if (!(await billingGateOk(v.exceptionId, api))) {
    return NextResponse.json({ error: { code: "forbidden", message: "Requiere permiso de facturación" } }, { status: 403 });
  }
  // meta: JSON no sensible (el cliente solo manda ids/fechas). Se ACOTA por tamaño
  // para evitar payloads enormes/DoS; nunca debe llevar importes/PII.
  let meta: any = v.meta && typeof v.meta === "object" ? v.meta : null;
  if (meta) {
    let bytes = 0;
    try {
      bytes = JSON.stringify(meta).length;
    } catch {
      bytes = META_MAX_BYTES + 1; // no serializable → rechazar
    }
    if (bytes > META_MAX_BYTES) {
      return NextResponse.json({ error: { code: "bad_request", message: "meta demasiado grande" } }, { status: 400 });
    }
  }

  const data = {
    dedupeKey: v.dedupeKey,
    reason: v.reason ?? null,
    severity: v.severity ?? null,
    expiresAt: v.expiresAt ? new Date(v.expiresAt) : null,
    meta: meta as any,
    actorId: api.userId ?? null,
    revokedAt: null
  };
  let saved: { id: string; action: string };
  try {
    saved = await prisma.exceptionAction.upsert({
      where: { workspaceId_exceptionId_action: { workspaceId: ws, exceptionId: v.exceptionId, action: v.action } },
      create: { workspaceId: ws, exceptionId: v.exceptionId, source: v.source, kind: v.kind, action: v.action, ...data },
      update: data
    });
  } catch (e: any) {
    // Carrera de inserción concurrente (P2002): la fila ya existe → aplicar update
    // (idempotente), no fallar.
    if (e?.code === "P2002") {
      await prisma.exceptionAction.updateMany({ where: { workspaceId: ws, exceptionId: v.exceptionId, action: v.action }, data });
      saved = { id: "", action: v.action };
    } else {
      throw e;
    }
  }

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
