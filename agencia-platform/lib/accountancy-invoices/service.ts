import { prisma } from "@/lib/db/prisma";
import { getPreviousMonthPeriod, getRunHealth, getSourceDownloadOutcome } from "./domain";
import { shouldRunMonthlySchedule } from "./domain";
import { holdedGetInvoicePdf, holdedListInvoices } from "@/lib/integrations/holded";
import { gadsDownloadInvoicePdf, gadsListInvoices } from "@/lib/integrations/google-ads";
import { findMetaBillingPdfAttachments } from "@/lib/integrations/email-account";
import { buildS3Key, isStorageEnabled, signedDownloadUrl, uploadBuffer } from "@/lib/storage/r2";

export const DEFAULT_RECIPIENTS = ["info@negociovivo.com"];
export const SOURCES = ["HOLDED", "META", "GOOGLE_ADS", "BANK"] as const;

const DEFAULT_CLIENTS = [
  ["Holded - todas las facturas", "HOLDED", "holded-sales-revenue"],
  ["Automatic Choice y Campañas Negocio Vivo", "META", "290451863303865"],
  ["RS Avocat 2026 NV", "META", "1477993670483838"],
  ["RSADVOCATS", "META", "911251981746237"],
  ["EUROSISTEMAS", "META", "304176041819854"],
  ["LA MARISCÁ", "META", "585809849125581"],
  ["NEGOCIO VIVO", "META", "2074249599540370"],
  ["David Díaz Ríos", "META", "1906884993251"],
  ["Mudanzas Reva", "GOOGLE_ADS", "384-789-9827"],
  ["Taxi Grande Málaga", "GOOGLE_ADS", "249-419-3921"],
  ["Tecnoidentia NV", "GOOGLE_ADS", "708-187-4860"],
  ["Automatic Choice", "GOOGLE_ADS", "918-792-1793"],
  ["Mudanzas Lorena", "GOOGLE_ADS", "mudanzas-lorena"],
  ["Eroski Franquicias", "GOOGLE_ADS", "196-147-6671"],
  ["NV - México", "GOOGLE_ADS", "631-103-4413"],
  ["LATAM", "GOOGLE_ADS", "660-810-9819"]
] as const;

const GOOGLE_CONNECTIONS: Record<string, string> = {
  "384-789-9827": "tunegociovivo@gmail.com",
  "249-419-3921": "tunegociovivo@gmail.com",
  "708-187-4860": "tunegociovivo@gmail.com",
  "918-792-1793": "tunegociovivo@gmail.com",
  "mudanzas-lorena": "tunegociovivo@gmail.com",
  "196-147-6671": "eroskifranquicias.marketing@gmail.com",
  "631-103-4413": "eroskifranquicias.marketing@gmail.com",
  "660-810-9819": "eroskifranquicias.marketing@gmail.com"
};

export async function ensureDefaultAccountancyClients(workspaceId: string) {
  const googleIdMigrations = [
    ["taxi-grande-malaga", "249-419-3921"],
    ["automatic-choice", "918-792-1793"],
    ["https://ads.google.com/aw/billing/documents?ocid=59412057", "196-147-6671"],
    ["https://ads.google.com/aw/billing/documents?ocid=8406455988", "631-103-4413"],
    ["https://ads.google.com/aw/billing/documents?ocid=6587199532", "660-810-9819"]
  ] as const;
  for (const [oldId, externalAccountId] of googleIdMigrations) {
    await prisma.accountancyInvoiceClient.updateMany({ where: { workspaceId, source: "GOOGLE_ADS", externalAccountId: oldId }, data: { externalAccountId } });
  }
  await prisma.accountancyInvoiceClient.createMany({
    data: DEFAULT_CLIENTS.map(([name, source, externalAccountId]) => ({ workspaceId, name, source, externalAccountId, connectionRef: source === "GOOGLE_ADS" ? GOOGLE_CONNECTIONS[externalAccountId] : null })),
    skipDuplicates: true
  });
  for (const [externalAccountId, connectionRef] of Object.entries(GOOGLE_CONNECTIONS)) {
    await prisma.accountancyInvoiceClient.updateMany({ where: { workspaceId, source: "GOOGLE_ADS", externalAccountId }, data: { connectionRef } });
  }
  await prisma.accountancyInvoiceSchedule.upsert({
    where: { workspaceId },
    create: { workspaceId, recipients: DEFAULT_RECIPIENTS },
    update: {}
  });
}

export async function processPendingGoogleAdsInvoiceRun(runId?: string) {
  const pending = await prisma.accountancyInvoiceRunItem.findFirst({
    where: { source: "GOOGLE_ADS", status: "PENDING", ...(runId ? { runId } : {}) },
    include: { run: true, client: true },
    // Prioriza la ejecución mensual más reciente; los intentos históricos no
    // deben retrasar la entrega actual.
    orderBy: { createdAt: "desc" }
  });
  if (!pending) return null;
  const claimed = await prisma.accountancyInvoiceRunItem.updateMany({ where: { id: pending.id, status: "PENDING" }, data: { status: "RUNNING", startedAt: new Date(), error: null } });
  if (!claimed.count) return null;
  try {
    if (!isStorageEnabled()) throw new Error("Storage no configurado para archivar las facturas");
    const customerId = String(pending.client?.externalAccountId || "").replace(/\D/g, "");
    if (!customerId) throw new Error("Configura el ID numérico de Google Ads de esta cuenta");
    const invoices = await gadsListInvoices({
      workspaceId: pending.run.workspaceId,
      connectionRef: pending.client?.connectionRef,
      customerId,
      issueYear: pending.run.periodFrom.getUTCFullYear(),
      issueMonth: pending.run.periodFrom.getUTCMonth() + 1
    });
    const files: Array<{ id: string; name: string; url: string }> = [];
    const errors: string[] = [];
    let amountCents = 0;
    for (const invoice of invoices) {
      try {
        const buffer = await gadsDownloadInvoicePdf({ workspaceId: pending.run.workspaceId, connectionRef: pending.client?.connectionRef, invoice });
        const name = `google-ads-${customerId}-${invoice.number || invoice.id}.pdf`.replace(/[^a-zA-Z0-9._-]+/g, "_");
        const s3Key = buildS3Key({ workspaceId: pending.run.workspaceId, targetType: "ACCOUNTANCY_RUN_ITEM", targetId: pending.id, filename: name });
        await uploadBuffer({ s3Key, body: buffer, contentType: "application/pdf" });
        const row = await prisma.file.create({ data: { workspaceId: pending.run.workspaceId, name, mimeType: "application/pdf", sizeBytes: buffer.length, s3Key, targetType: "ACCOUNTANCY_RUN_ITEM", targetId: pending.id } });
        files.push({ id: row.id, name, url: await signedDownloadUrl(s3Key, 7 * 24 * 3600) });
        amountCents += Math.round(invoice.totalAmountMicros / 10_000);
      } catch (error: any) {
        errors.push(`${invoice.number || invoice.id}: ${String(error?.message || error).slice(0, 180)}`);
      }
    }
    const outcome = getSourceDownloadOutcome(invoices.length, files.length, errors);
    await prisma.accountancyInvoiceRunItem.update({ where: { id: pending.id }, data: { status: outcome.status, error: outcome.error?.slice(0, 1000) ?? null, invoiceCount: files.length, amountCents, currency: invoices[0]?.currency || "EUR", files, invoiceDetails: invoices.map((invoice) => ({ number: invoice.number, date: invoice.issueDate, amountCents: Math.round(invoice.totalAmountMicros / 10_000), currency: invoice.currency })), finishedAt: new Date() } });
  } catch (error: any) {
    await prisma.accountancyInvoiceRunItem.update({ where: { id: pending.id }, data: { status: "FAILED", error: String(error?.message || error).slice(0, 1000), finishedAt: new Date() } });
  }
  await refreshRunStatus(pending.runId);
  return pending.id;
}

export async function processAllPendingGoogleAdsInvoiceRun(runId?: string, limit = 20) {
  let processed = 0;
  while (processed < limit && await processPendingGoogleAdsInvoiceRun(runId)) processed++;
  return processed;
}

export async function processAllPendingMetaInvoiceRun(runId?: string, limit = 20) {
  const pending = await prisma.accountancyInvoiceRunItem.findMany({ where: { source: "META", status: "PENDING", ...(runId ? { runId } : {}) }, include: { run: true, client: true }, orderBy: { createdAt: "desc" }, take: limit });
  for (const group of [...new Set(pending.map((item) => item.runId))]) {
    const items = pending.filter((item) => item.runId === group);
    const run = items[0].run;
    const account = await prisma.emailAccount.findFirst({ where: { workspaceId: run.workspaceId }, orderBy: { updatedAt: "desc" } });
    let attachments: Awaited<ReturnType<typeof findMetaBillingPdfAttachments>> = [];
    let scanError: string | null = null;
    if (!account) scanError = "No hay un buzón corporativo conectado para buscar recibos PDF de Meta.";
    else {
      try {
        attachments = await findMetaBillingPdfAttachments({ userId: account.userId, workspaceId: run.workspaceId, from: run.periodFrom, to: run.periodTo, accountIds: items.map((item) => String(item.client?.externalAccountId || "")).filter(Boolean) });
      } catch (error: any) { scanError = `No se pudo revisar el buzón de facturación: ${String(error?.message || error).slice(0, 500)}`; }
    }
    for (const item of items) {
      const accountId = String(item.client?.externalAccountId || "").replace(/\D/g, "");
      const matches = attachments.filter((file) => file.accountId.replace(/\D/g, "") === accountId);
      const files: Array<{ id: string; name: string; url: string }> = [];
      for (const match of matches) {
        const name = `meta-${accountId}-${match.filename}`.replace(/[^a-zA-Z0-9._-]+/g, "_");
        const s3Key = buildS3Key({ workspaceId: run.workspaceId, targetType: "ACCOUNTANCY_RUN_ITEM", targetId: item.id, filename: name });
        await uploadBuffer({ s3Key, body: match.content, contentType: "application/pdf" });
        const row = await prisma.file.create({ data: { workspaceId: run.workspaceId, name, mimeType: "application/pdf", sizeBytes: match.content.length, s3Key, targetType: "ACCOUNTANCY_RUN_ITEM", targetId: item.id } });
        files.push({ id: row.id, name, url: await signedDownloadUrl(s3Key, 7 * 24 * 3600) });
      }
      const error = scanError || (!accountId ? "Falta el ID numérico de la cuenta de Meta." : !matches.length ? "No se encontró ningún recibo PDF inequívocamente asociado a esta cuenta en el buzón del periodo." : null);
      await prisma.accountancyInvoiceRunItem.update({ where: { id: item.id }, data: { status: files.length ? "DOWNLOADED" : "FAILED", error, invoiceCount: files.length, amountCents: matches.reduce((sum, file) => sum + (file.amountCents || 0), 0), files, invoiceDetails: matches.map((file) => ({ number: file.filename.replace(/\.pdf$/i, ""), date: file.messageDate?.toISOString().slice(0, 10) || "", amountCents: file.amountCents || 0, currency: "EUR" })), startedAt: new Date(), finishedAt: new Date() } });
    }
    await refreshRunStatus(group);
  }
  return pending.length;
}

export async function createAccountancyInvoiceRun(workspaceId: string, trigger: "MANUAL" | "SCHEDULED", now = new Date()) {
  const period = getPreviousMonthPeriod(now);
  const clients = await prisma.accountancyInvoiceClient.findMany({ where: { workspaceId, enabled: true }, orderBy: [{ source: "asc" }, { name: "asc" }] });
  const schedule = await prisma.accountancyInvoiceSchedule.findUnique({ where: { workspaceId } });
  return prisma.accountancyInvoiceRun.create({
    data: {
      workspaceId,
      periodKey: period.key,
      periodFrom: new Date(`${period.from}T00:00:00.000Z`),
      periodTo: new Date(`${period.to}T23:59:59.999Z`),
      trigger,
      recipients: schedule?.recipients ?? DEFAULT_RECIPIENTS,
      items: { create: clients.map((client) => ({ clientId: client.id, clientName: client.name, source: client.source })) }
    },
    include: { items: true }
  });
}

export async function refreshRunStatus(runId: string) {
  const run = await prisma.accountancyInvoiceRun.findUnique({ where: { id: runId }, include: { items: true } });
  if (!run) throw new Error("Ejecución no encontrada");
  const status = getRunHealth(run.items);
  const updated = await prisma.accountancyInvoiceRun.update({
    where: { id: runId },
    data: { status, ...(status === "SUCCESS" || status === "PARTIAL" || status === "FAILED" ? { finishedAt: new Date() } : {}) }
  });
  if (updated.trigger === "SCHEDULED" && ["SUCCESS", "PARTIAL", "FAILED"].includes(updated.status)) {
    setImmediate(() => import("./delivery").then(({ deliverScheduledAccountancyRun }) => deliverScheduledAccountancyRun(runId)).catch((error) => console.warn("[facturas-gestoria] envío automático:", error?.message || error)));
  }
  return updated;
}

export async function runAccountancySchedules(now = new Date()) {
  const schedules = await prisma.accountancyInvoiceSchedule.findMany({ where: { enabled: true } });
  let created = 0;
  for (const schedule of schedules) {
    if (!shouldRunMonthlySchedule(now, schedule, schedule.lastRunMonth)) continue;
    await createAccountancyInvoiceRun(schedule.workspaceId, "SCHEDULED", now);
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: schedule.timezone, year: "numeric", month: "2-digit" }).formatToParts(now).reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});
    await prisma.accountancyInvoiceSchedule.update({ where: { id: schedule.id }, data: { lastRunMonth: `${parts.year}-${parts.month}` } });
    created++;
  }
  return created;
}

export async function processPendingHoldedInvoiceRun(runId?: string) {
  const pending = await prisma.accountancyInvoiceRunItem.findFirst({
    where: { source: "HOLDED", status: "PENDING", ...(runId ? { runId } : {}) },
    include: { run: true },
    orderBy: { createdAt: "asc" }
  });
  if (!pending) return null;
  const claimed = await prisma.accountancyInvoiceRunItem.updateMany({ where: { id: pending.id, status: "PENDING" }, data: { status: "RUNNING", startedAt: new Date(), error: null } });
  if (!claimed.count) return null;
  try {
    if (!isStorageEnabled()) throw new Error("Storage no configurado para archivar las facturas");
    const invoices = await holdedListInvoices({ workspaceId: pending.run.workspaceId, startTimestamp: Math.floor(pending.run.periodFrom.getTime() / 1000), endTimestamp: Math.floor(pending.run.periodTo.getTime() / 1000), limit: 500, sort: "created-asc" });
    const files: Array<{ id: string; name: string; url: string }> = [];
    const downloadedInvoiceIds = new Set<string>();
    const errors: string[] = [];
    for (let offset = 0; offset < invoices.length; offset += 5) {
      const batch = invoices.slice(offset, offset + 5);
      const stored = await Promise.all(batch.map(async (invoice) => {
        try {
          const buffer = await holdedGetInvoicePdf({ workspaceId: pending.run.workspaceId, invoiceId: invoice.id });
          const name = `${invoice.docNumber || invoice.id}.pdf`.replace(/[^a-zA-Z0-9._-]+/g, "_");
          const s3Key = buildS3Key({ workspaceId: pending.run.workspaceId, targetType: "ACCOUNTANCY_RUN_ITEM", targetId: pending.id, filename: name });
          await uploadBuffer({ s3Key, body: buffer, contentType: "application/pdf" });
          const row = await prisma.file.create({ data: { workspaceId: pending.run.workspaceId, name, mimeType: "application/pdf", sizeBytes: buffer.length, s3Key, targetType: "ACCOUNTANCY_RUN_ITEM", targetId: pending.id } });
          downloadedInvoiceIds.add(invoice.id);
          return { id: row.id, name, url: await signedDownloadUrl(s3Key, 7 * 24 * 3600) };
        } catch (error: any) {
          errors.push(`${invoice.docNumber || invoice.id}: ${String(error?.message || error).slice(0, 160)}`);
          return null;
        }
      }));
      files.push(...stored.filter((file): file is NonNullable<typeof file> => file !== null));
    }
    const outcome = getSourceDownloadOutcome(invoices.length, files.length, errors);
    const downloadedInvoices = invoices.filter((invoice) => downloadedInvoiceIds.has(invoice.id));
    await prisma.accountancyInvoiceRunItem.update({ where: { id: pending.id }, data: { status: outcome.status, error: outcome.error?.slice(0, 1000) ?? null, invoiceCount: files.length, amountCents: downloadedInvoices.reduce((sum, invoice) => sum + Math.round(Number(invoice.total || 0) * 100), 0), files, invoiceDetails: downloadedInvoices.map((invoice) => ({ number: invoice.docNumber || invoice.id, date: invoice.date ? new Date(invoice.date * 1000).toISOString().slice(0, 10) : "", amountCents: Math.round(Number(invoice.total || 0) * 100), currency: invoice.currency || "EUR", business: invoice.contactName || "" })), finishedAt: new Date() } });
  } catch (error: any) {
    await prisma.accountancyInvoiceRunItem.update({ where: { id: pending.id }, data: { status: "FAILED", error: String(error?.message || error).slice(0, 1000), finishedAt: new Date() } });
  }
  await refreshRunStatus(pending.runId);
  return pending.id;
}
