import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api/auth";
import { derivePaymentState, validatePaymentAmount } from "./payments";

type LedgerTx = Prisma.TransactionClient;

export async function syncInvoicePaymentState(tx: LedgerTx, invoiceId: string, totalCents: number) {
  const [balance, lastPayment] = await Promise.all([
    tx.invoicePayment.aggregate({ where: { invoiceId }, _sum: { amountCents: true } }),
    tx.invoicePayment.findFirst({
      where: { invoiceId, kind: "PAYMENT" },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      select: { occurredAt: true }
    })
  ]);
  const state = derivePaymentState(totalCents, balance._sum.amountCents ?? 0, lastPayment?.occurredAt);
  return tx.invoice.update({ where: { id: invoiceId }, data: state });
}

export async function registerInvoicePayment(
  tx: LedgerTx,
  input: {
    workspaceId: string;
    invoiceId: string;
    amountCents: number;
    occurredAt: Date;
    method: string;
    reference?: string | null;
    notes?: string | null;
    actorId?: string | null;
  }
) {
  // Serializa movimientos de la misma factura: dos peticiones simultáneas no
  // pueden validar ambas contra el mismo saldo y producir un sobrecobro.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.invoiceId}))`;
  const invoice = await tx.invoice.findFirst({
    where: { id: input.invoiceId, workspaceId: input.workspaceId, deletedAt: null }
  });
  if (!invoice) throw new ApiError(404, "not_found", "Factura no encontrada");
  if (["PRESUPUESTO", "PROFORMA"].includes(invoice.type)) {
    throw new ApiError(400, "invalid_state", "Un presupuesto o proforma no admite cobros.");
  }
  if (!invoice.number || ["DRAFT", "CANCELLED"].includes(invoice.status)) {
    throw new ApiError(400, "invalid_state", "Solo se pueden cobrar facturas emitidas y no anuladas.");
  }

  let balance = await tx.invoicePayment.aggregate({
    where: { invoiceId: invoice.id },
    _sum: { amountCents: true }
  });
  // Compatibilidad para despliegues que creen las tablas con db push y no
  // ejecuten el backfill SQL de la migración.
  if (balance._sum.amountCents == null && invoice.paidCents > 0) {
    await tx.invoicePayment.create({
      data: {
        id: `legacy_payment_${invoice.id}`,
        workspaceId: input.workspaceId,
        invoiceId: invoice.id,
        amountCents: invoice.paidCents,
        currency: invoice.currency,
        occurredAt: invoice.paidAt ?? invoice.updatedAt,
        method: invoice.paymentMethod,
        notes: "Saldo migrado del sistema anterior"
      }
    });
    balance = { _sum: { amountCents: invoice.paidCents } };
  }
  const outstandingCents = Math.max(invoice.totalCents - (balance._sum.amountCents ?? invoice.paidCents), 0);
  const validationError = validatePaymentAmount(input.amountCents, outstandingCents);
  if (validationError) throw new ApiError(400, "invalid_payment", validationError);

  const payment = await tx.invoicePayment.create({
    data: {
      workspaceId: input.workspaceId,
      invoiceId: invoice.id,
      amountCents: input.amountCents,
      currency: invoice.currency,
      occurredAt: input.occurredAt,
      method: input.method,
      reference: input.reference || null,
      notes: input.notes || null,
      createdById: input.actorId || null
    }
  });
  await tx.invoiceEvent.create({
    data: {
      workspaceId: input.workspaceId,
      invoiceId: invoice.id,
      type: "PAYMENT_RECORDED",
      actorId: input.actorId || null,
      data: { paymentId: payment.id, amountCents: payment.amountCents, method: payment.method }
    }
  });
  const updatedInvoice = await syncInvoicePaymentState(tx, invoice.id, invoice.totalCents);
  return { payment, invoice: updatedInvoice };
}

export async function reverseInvoicePayment(
  tx: LedgerTx,
  input: { workspaceId: string; invoiceId: string; paymentId: string; reason?: string | null; actorId?: string | null }
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.invoiceId}))`;
  const payment = await tx.invoicePayment.findFirst({
    where: {
      id: input.paymentId,
      invoiceId: input.invoiceId,
      workspaceId: input.workspaceId,
      kind: "PAYMENT"
    },
    include: { invoice: true }
  });
  if (!payment || payment.invoice.deletedAt) throw new ApiError(404, "not_found", "Cobro no encontrado");
  if (payment.invoice.status === "CANCELLED") {
    throw new ApiError(409, "invoice_cancelled", "No se puede modificar el saldo de una factura anulada.");
  }
  const existingReversal = await tx.invoicePayment.findUnique({ where: { reversesPaymentId: payment.id } });
  if (existingReversal) throw new ApiError(409, "already_reversed", "Este cobro ya fue revertido.");

  const reversal = await tx.invoicePayment.create({
    data: {
      workspaceId: input.workspaceId,
      invoiceId: input.invoiceId,
      kind: "REVERSAL",
      amountCents: -payment.amountCents,
      currency: payment.currency,
      occurredAt: new Date(),
      method: payment.method,
      reference: payment.reference,
      notes: input.reason || "Reversión de cobro",
      reversesPaymentId: payment.id,
      createdById: input.actorId || null
    }
  });
  await tx.invoiceEvent.create({
    data: {
      workspaceId: input.workspaceId,
      invoiceId: input.invoiceId,
      type: "PAYMENT_REVERSED",
      actorId: input.actorId || null,
      data: { paymentId: payment.id, reversalId: reversal.id, amountCents: payment.amountCents }
    }
  });
  const updatedInvoice = await syncInvoicePaymentState(tx, input.invoiceId, payment.invoice.totalCents);
  return { reversal, invoice: updatedInvoice };
}
