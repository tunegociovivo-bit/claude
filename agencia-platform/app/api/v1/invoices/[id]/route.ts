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
    const updated = await prisma.invoice.update({ where: { id: current.id }, data: allowed });
    return NextResponse.json(updated);
  }

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const data = await buildInvoiceData({ workspaceId: api.workspaceId, input: parsed.data, current, transactionClient: tx });
      return tx.invoice.update({ where: { id: current.id }, data });
    }, { isolationLevel: "Serializable" });
  } catch (error: any) {
    if (error?.code === "CUSTOM_INVOICE_NUMBER_SEQUENCE") throw new ApiError(409, "invoice_number_sequence", error.message);
    if (error?.code === "P2002" && parsed.data.number) throw new ApiError(409, "duplicate_invoice_number", "Ese número de factura ya existe");
    throw error;
  }
  return NextResponse.json(updated);
});

export const DELETE = withApi({ scope: "*", rate: "destructive" }, async (_req, { api, params }) => {
  await requireAdmin(api);
  const current = await getOwned(api.workspaceId, params.id);
  // Las facturas emitidas NO se borran de verdad: se anulan (status
  // CANCELLED) para mantener la trazabilidad legal. Los borradores sí
  // se pueden eliminar (soft-delete).
  if (current.number && current.status !== "DRAFT" && current.status !== "CANCELLED") {
    const cancelled = await prisma.invoice.update({
      where: { id: current.id },
      data: { status: "CANCELLED" }
    });
    return NextResponse.json({ ok: true, cancelled: true, invoice: cancelled });
  }
  await prisma.invoice.update({
    where: { id: current.id },
    data: { deletedAt: new Date(), deletedById: api.userId ?? null }
  });
  return NextResponse.json({ ok: true, deleted: true });
});
