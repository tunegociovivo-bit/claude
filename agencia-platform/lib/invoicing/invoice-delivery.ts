import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { getResendConfig, sendViaResend } from "@/lib/integrations/email";
import { buildInvoiceEmail, invoiceRecipient, type InvoiceReminderKey } from "./invoice-email";
import { buildInvoiceHtml, type InvoiceParty } from "./invoice-html";
import type { InvoiceLine } from "./core";

export async function deliverInvoice(input: {
  workspaceId: string;
  invoiceId: string;
  recipient?: string | null;
  kind: "INVOICE" | "REMINDER";
  reminderKey?: InvoiceReminderKey | null;
  dedupeKey: string;
  actorId?: string | null;
}) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: input.invoiceId, workspaceId: input.workspaceId, deletedAt: null },
    include: { client: true, issuer: true }
  });
  if (!invoice) throw new ApiError(404, "not_found", "Factura no encontrada");
  if (!invoice.number || ["DRAFT", "CANCELLED"].includes(invoice.status)) {
    throw new ApiError(409, "invalid_state", "Solo se pueden enviar facturas emitidas y no anuladas.");
  }

  const recipient = (input.recipient || invoiceRecipient(invoice.client, invoice.clientSnapshot))?.trim().toLowerCase();
  if (!recipient) throw new ApiError(400, "missing_recipient", "El cliente no tiene un email de facturación.");
  const clientSnapshot = (invoice.clientSnapshot as Record<string, unknown> | null) ?? {};
  const issuerSnapshot = (invoice.issuerSnapshot as Record<string, unknown> | null) ?? {};
  const clientName = String(clientSnapshot.name || invoice.client?.name || "cliente");
  const issuerName = String(issuerSnapshot.legalName || issuerSnapshot.name || invoice.issuer?.name || "Negocio Vivo");
  const content = buildInvoiceEmail({
    clientName,
    issuerName,
    invoiceNumber: invoice.number,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    totalCents: invoice.totalCents,
    outstandingCents: Math.max(invoice.totalCents - invoice.paidCents, 0),
    currency: invoice.currency,
    kind: input.kind,
    reminderKey: input.reminderKey
  });
  const emailHtml = input.kind === "INVOICE"
    ? buildInvoiceHtml({
        type: invoice.type,
        status: invoice.status,
        number: invoice.number,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        currency: invoice.currency,
        paymentMethod: invoice.paymentMethod,
        lines: invoice.lines as unknown as InvoiceLine[],
        notes: invoice.notes,
        terms: invoice.terms,
        issuer: issuerSnapshot as InvoiceParty,
        client: clientSnapshot as InvoiceParty
      })
    : content.html;
  const config = await getResendConfig(input.workspaceId);
  const apiKey = config.apiKey;
  if (!apiKey) throw new ApiError(503, "email_not_configured", "Configura Resend antes de enviar facturas.");

  let delivery;
  let providerAccepted = false;
  try {
    delivery = await prisma.invoiceDelivery.create({
      data: {
        workspaceId: input.workspaceId,
        invoiceId: invoice.id,
        kind: input.kind,
        reminderKey: input.reminderKey ?? null,
        recipient,
        subject: content.subject,
        dedupeKey: input.dedupeKey,
        createdById: input.actorId ?? null
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const previous = await prisma.invoiceDelivery.findUnique({ where: { dedupeKey: input.dedupeKey } });
      const stalePending = previous?.status === "PENDING" && Date.now() - previous.updatedAt.getTime() > 60_000;
      if (previous?.status === "FAILED" || stalePending) {
        delivery = await prisma.invoiceDelivery.update({
          where: { id: previous.id },
          data: { status: "PENDING", error: null }
        });
      } else {
        throw new ApiError(409, "already_sent", "Este envío ya está registrado y no se duplicará.");
      }
    } else {
      throw error;
    }
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (input.kind === "REMINDER") {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${invoice.id}))`;
        const freshInvoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
        if (freshInvoice.status !== "ISSUED" || freshInvoice.paidCents >= freshInvoice.totalCents) {
          throw new ApiError(409, "invoice_not_outstanding", "La factura ya no está pendiente de cobro.");
        }
      }
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${delivery.id}))`;
      const current = await tx.invoiceDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      if (["SENT", "DELIVERED", "DELAYED", "BOUNCED", "COMPLAINED"].includes(current.status)) return current;
      const result = await sendViaResend({
        apiKey,
        from: config.from,
        replyTo: typeof issuerSnapshot.email === "string" ? issuerSnapshot.email : undefined,
        to: recipient,
        subject: content.subject,
        html: emailHtml,
        text: content.text,
        idempotencyKey: delivery.id,
        tags: [{ name: "delivery_id", value: delivery.id }]
      });
      providerAccepted = true;
      const sent = await tx.invoiceDelivery.update({
        where: { id: delivery.id },
        data: { status: "SENT", providerId: result.id, sentAt: current.sentAt ?? new Date(), error: null }
      });
      await tx.invoiceEvent.create({
        data: {
          workspaceId: input.workspaceId,
          invoiceId: invoice.id,
          type: input.kind === "REMINDER" ? "INVOICE_REMINDER_SENT" : "INVOICE_EMAIL_SENT",
          actorId: input.actorId ?? null,
          data: { deliveryId: sent.id, recipient, providerId: result.id, reminderKey: input.reminderKey ?? null }
        }
      });
      return sent;
    }, { maxWait: 5_000, timeout: 25_000 });
  } catch (error) {
    const outcomeUnknown = providerAccepted || (error as any)?.deliveryOutcome === "UNKNOWN";
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${delivery.id}))`;
      const fresh = await tx.invoiceDelivery.findUnique({ where: { id: delivery.id } });
      if (!fresh || fresh.status !== "PENDING" || fresh.providerId || fresh.providerEventAt) return;
      await tx.invoiceDelivery.update({
        where: { id: delivery.id },
        data: {
          status: outcomeUnknown ? "UNKNOWN" : "FAILED",
          error: String((error as Error)?.message ?? error).slice(0, 2000)
        }
      });
    }).catch(() => {});
    throw error;
  }
}
