import { prisma } from "@/lib/db/prisma";
import { computeTotals, defaultSeriesForType, type InvoiceLine, type InvoiceType } from "./core";
import { assignInvoiceNumber, reserveCustomInvoiceNumber } from "./numbering";
import { normalizeCustomInvoiceNumber } from "./invoice-form";

/** Datos fiscales congelados en la factura al emitir. */
export function snapshotIssuer(issuer: any) {
  if (!issuer) return null;
  return {
    name: issuer.name,
    legalName: issuer.legalName ?? null,
    taxId: issuer.taxId ?? null,
    address: issuer.address ?? null,
    postalCode: issuer.postalCode ?? null,
    city: issuer.city ?? null,
    province: issuer.province ?? null,
    countryCode: issuer.countryCode ?? "ESP",
    email: issuer.email ?? null,
    phone: issuer.phone ?? null,
    web: issuer.web ?? null,
    iban: issuer.iban ?? null,
    logoUrl: issuer.logoUrl ?? null,
    personType: issuer.personType ?? "J",
    residenceType: issuer.residenceType ?? "R"
  };
}

export function snapshotClient(client: any) {
  if (!client) return null;
  return {
    name: client.name,
    legalName: client.legalName ?? null,
    taxId: client.taxId ?? null,
    address: client.fiscalAddress ?? null,
    postalCode: client.postalCode ?? null,
    city: client.city ?? null,
    province: client.province ?? null,
    countryCode: client.countryCode ?? "ESP",
    email: client.email ?? null,
    billingEmail: client.billingEmail ?? null,
    phone: client.phone ?? null,
    personType: "J",
    residenceType: "R"
  };
}

/**
 * Construye el objeto `data` de Prisma para crear/actualizar una factura
 * a partir del input validado. Calcula totales, congela snapshots y asigna
 * número correlativo cuando deja de ser borrador.
 */
export async function buildInvoiceData(opts: {
  workspaceId: string;
  input: any;
  current?: any | null; // factura existente (en updates)
  transactionClient?: any;
}) {
  const { workspaceId, input, current, transactionClient } = opts;
  const db = transactionClient ?? prisma;
  const type = (input.type ?? current?.type ?? "NORMAL") as InvoiceType;
  const status = input.status ?? current?.status ?? "DRAFT";

  const lines = (input.lines ?? current?.lines ?? []) as InvoiceLine[];
  const totals = computeTotals(lines);

  // Snapshots: recalcular si cambia el emisor/cliente o si aún es borrador.
  const issuerId = input.issuerId !== undefined ? input.issuerId : current?.issuerId;
  const clientId = input.clientId !== undefined ? input.clientId : current?.clientId;

  let issuerSnapshot = current?.issuerSnapshot ?? null;
  let clientSnapshot = current?.clientSnapshot ?? null;
  const isDraft = (current?.status ?? "DRAFT") === "DRAFT";
  if (isDraft || input.issuerId !== undefined) {
    const issuer = issuerId
      ? await db.invoiceIssuer.findFirst({ where: { id: issuerId, workspaceId } })
      : null;
    issuerSnapshot = snapshotIssuer(issuer);
  }
  if (isDraft || input.clientId !== undefined) {
    const client = clientId
      ? await db.client.findFirst({ where: { id: clientId, workspaceId } })
      : null;
    clientSnapshot = snapshotClient(client);
  }

  const data: any = {
    type,
    status,
    issuerId: issuerId ?? null,
    clientId: clientId ?? null,
    issuerSnapshot,
    clientSnapshot,
    currency: input.currency ?? current?.currency ?? "EUR",
    paymentMethod: input.paymentMethod ?? current?.paymentMethod ?? "STRIPE",
    lines: lines as any,
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    notes: input.notes ?? current?.notes ?? null,
    terms: input.terms ?? current?.terms ?? null,
    rectifiesInvoiceId: input.rectifiesInvoiceId ?? current?.rectifiesInvoiceId ?? null,
    rectifyReason: input.rectifyReason ?? current?.rectifyReason ?? null,
    recurring: input.recurring ?? current?.recurring ?? false,
    recurrenceConfig: input.recurrenceConfig ?? current?.recurrenceConfig ?? null
  };

  if (input.number !== undefined) data.number = input.number ? normalizeCustomInvoiceNumber(input.number) : null;

  if (input.issueDate) data.issueDate = new Date(input.issueDate);
  if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;

  // Numeración: cuando deja de ser borrador y aún no tiene número, asigna
  // el siguiente correlativo de su serie. (No para plantillas recurrentes.)
  const series = (input.series || current?.series || defaultSeriesForType(type)) as string;
  data.series = series;
  const nowHasNumber = current?.number;
  const becomesNonDraft = status !== "DRAFT";
  if (!input.recurring && becomesNonDraft && !nowHasNumber && !data.number) {
    const issueYear = (data.issueDate ? new Date(data.issueDate) : new Date()).getFullYear();
    data.number = await assignInvoiceNumber(workspaceId, series, issueYear, transactionClient);
  }
  if (data.number && data.number !== nowHasNumber && transactionClient) {
    await reserveCustomInvoiceNumber(workspaceId, data.number, transactionClient);
  }

  return data;
}
