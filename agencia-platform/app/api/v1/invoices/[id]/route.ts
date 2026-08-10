import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { invoiceUpdateSchema } from "@/lib/api/schemas";
import { buildInvoiceData } from "@/lib/invoicing/persist";
import { canTransition, STATUS_LABEL, type InvoiceStatus, type InvoiceType } from "@/lib/invoicing/core";

async function getOwned(workspaceId: string, id: string) {
  const inv = await prisma.invoice.findFirst({ where: { id, workspaceId, deletedAt: null } });
  if (!inv) throw new ApiError(404, "not_found", "Factura no encontrada");
  return inv;
}

export const GET = withApi({ scope: "*", rate: "admin" }, async (_req, { api, params }) => {
  await requireAdmin(api);
  const inv = await prisma.invoice.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    include: {
      client: { select: { id: true, name: true } },
      issuer: { select: { id: true, name: true } }
    }
  });
  if (!inv) throw new ApiError(404, "not_found", "Factura no encontrada");
  return NextResponse.json(inv);
});

export const PATCH = withApi({ scope: "*", rate: "admin" }, async (req, { api, params }) => {
  await requireAdmin(api);
  const current = await getOwned(api.workspaceId, params.id);
  // Una vez emitida (tiene número), no se reescriben líneas/totales: la
  // ley exige inmutabilidad. Solo se permite cambiar status (p.ej. a PAID
  // o CANCELLED) y datos de cobro.
  const body = await req.json().catch(() => null);
  const parsed = invoiceUpdateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  if (parsed.data.status === "PAID" || (current.status === "PAID" && parsed.data.status === "ISSUED")) {
    throw new ApiError(
      409,
      "payment_ledger_required",
      "El estado de cobro solo puede cambiar registrando o revirtiendo un movimiento de cobro."
    );
  }

  // Máquina de estados por tipo: evita incoherencias (un presupuesto "pagado",
  // resucitar una anulada, saltar de borrador a pagada, etc.).
  if (parsed.data.status && parsed.data.status !== current.status) {
    const from = current.status as InvoiceStatus;
    const to = parsed.data.status as InvoiceStatus;
    if (!canTransition((parsed.data.type ?? current.type) as InvoiceType, from, to)) {
      throw new ApiError(
        400,
        "invalid_transition",
        `No se puede pasar de "${STATUS_LABEL[from] ?? from}" a "${STATUS_LABEL[to] ?? to}" en este tipo de documento.`
      );
    }
  }

  const alreadyIssued = !!current.number && current.status !== "DRAFT";
  if (alreadyIssued) {
    const allowed: any = {};
    if (parsed.data.status) allowed.status = parsed.data.status;
    if (parsed.data.paymentMethod) allowed.paymentMethod = parsed.data.paymentMethod;
    if (parsed.data.notes !== undefined) allowed.notes = parsed.data.notes;
    if (Object.keys(allowed).length === 0) {
      throw new ApiError(409, "invoice_locked", "Una factura emitida no se puede editar; solo su estado.");
    }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${current.id}))`;
      const fresh = await tx.invoice.findUniqueOrThrow({ where: { id: current.id } });
      if (parsed.data.status === "PAID" || (fresh.status === "PAID" && parsed.data.status === "ISSUED")) {
        throw new ApiError(
          409,
          "payment_ledger_required",
          "El estado de cobro cambió. Usa el historial de cobros para registrarlo o revertirlo."
        );
      }
      if (parsed.data.status && parsed.data.status !== fresh.status) {
        const from = fresh.status as InvoiceStatus;
        const to = parsed.data.status as InvoiceStatus;
        if (!canTransition(fresh.type as InvoiceType, from, to)) {
          throw new ApiError(409, "concurrent_state_change", "La factura cambió mientras se editaba. Recarga y vuelve a intentarlo.");
        }
      }
      const invoice = await tx.invoice.update({ where: { id: current.id }, data: allowed });
      await tx.invoiceEvent.create({
        data: {
          workspaceId: api.workspaceId,
          invoiceId: current.id,
          type: parsed.data.status && parsed.data.status !== current.status ? "STATUS_CHANGED" : "INVOICE_UPDATED",
          actorId: api.userId,
          data: { fromStatus: fresh.status, toStatus: invoice.status, fields: Object.keys(allowed) }
        }
      });
      return invoice;
    });
    return NextResponse.json(updated);
  }

  const data = await buildInvoiceData({ workspaceId: api.workspaceId, input: parsed.data, current });
  const updated = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.update({ where: { id: current.id }, data });
    await tx.invoiceEvent.create({
      data: {
        workspaceId: api.workspaceId,
        invoiceId: current.id,
        type: invoice.number && !current.number ? "INVOICE_ISSUED" : "INVOICE_UPDATED",
        actorId: api.userId,
        data: { fromStatus: current.status, toStatus: invoice.status, number: invoice.number }
      }
    });
    return invoice;
  });
  return NextResponse.json(updated);
});

export const DELETE = withApi({ scope: "*", rate: "destructive" }, async (_req, { api, params }) => {
  await requireAdmin(api);
  const current = await getOwned(api.workspaceId, params.id);
  // Las facturas emitidas NO se borran de verdad: se anulan (status
  // CANCELLED) para mantener la trazabilidad legal. Los borradores sí
  // se pueden eliminar (soft-delete).
  if (current.number && current.status !== "DRAFT") {
    const cancelled = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${current.id}))`;
      const fresh = await tx.invoice.findUniqueOrThrow({ where: { id: current.id } });
      if (fresh.status === "CANCELLED") return fresh;
      const invoice = await tx.invoice.update({ where: { id: current.id }, data: { status: "CANCELLED" } });
      await tx.invoiceEvent.create({
        data: {
          workspaceId: api.workspaceId,
          invoiceId: current.id,
          type: "INVOICE_CANCELLED",
          actorId: api.userId,
          data: { fromStatus: fresh.status }
        }
      });
      return invoice;
    });
    return NextResponse.json({ ok: true, cancelled: true, invoice: cancelled });
  }
  await prisma.$transaction(async (tx) => {
    await tx.invoiceEvent.create({
      data: { workspaceId: api.workspaceId, invoiceId: current.id, type: "DRAFT_DELETED", actorId: api.userId }
    });
    await tx.invoice.update({
      where: { id: current.id },
      data: { deletedAt: new Date(), deletedById: api.userId ?? null }
    });
  });
  return NextResponse.json({ ok: true, deleted: true });
});
