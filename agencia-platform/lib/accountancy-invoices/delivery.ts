import { zipSync } from "fflate";
import { prisma } from "@/lib/db/prisma";
import { sendEmailFromAccount } from "@/lib/integrations/email-account";
import { buildS3Key, downloadBuffer, isStorageEnabled, signedDownloadUrl, uploadBuffer } from "@/lib/storage/r2";
import { buildAccountancyReport } from "./report";

export async function deliverAccountancyRun(opts: { runId: string; workspaceId: string; userId: string; recipients: string[]; ccRecipients?: string[] }) {
  const run = await prisma.accountancyInvoiceRun.findFirst({ where: { id: opts.runId, workspaceId: opts.workspaceId }, include: { items: true } });
  if (!run) throw new Error("Ejecución no encontrada");
  if (!isStorageEnabled()) throw new Error("Storage no configurado");
  const ids = run.items.flatMap((item) => Array.isArray(item.files) ? item.files.map((file: any) => file?.id).filter(Boolean) : []);
  if (!ids.length) throw new Error("La ejecución todavía no contiene facturas archivadas");
  const files = await prisma.file.findMany({ where: { id: { in: ids }, workspaceId: opts.workspaceId, targetType: "ACCOUNTANCY_RUN_ITEM" }, select: { name: true, s3Key: true, sizeBytes: true } });
  const archiveEntries: Record<string, Uint8Array> = {};
  const report = await buildAccountancyReport(run.periodKey, run.items);
  archiveEntries[`Resumen-facturas-${run.periodKey}.pdf`] = new Uint8Array(report.buffer, report.byteOffset, report.byteLength);
  const names = new Set<string>();
  for (const file of files) {
    let name = file.name;
    for (let suffix = 2; names.has(name); suffix++) name = file.name.replace(/(\.pdf)?$/i, `-${suffix}$1`);
    names.add(name);
    const contents = await downloadBuffer(file.s3Key);
    archiveEntries[name] = new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength);
  }
  const content = Buffer.from(zipSync(archiveEntries, { level: 6 }));
  // The ZIP is stored in R2 and the email only contains a signed download
  // link, so the usual email attachment limit does not apply here.
  const failed = run.items.filter((item) => item.status === "FAILED");
  const body = [`Documentación para gestoría - ${run.periodKey}`, "", `Facturas descargadas: ${run.items.reduce((sum, item) => sum + item.invoiceCount, 0)}`, `Cuentas correctas: ${run.items.filter((item) => item.status === "DOWNLOADED").length}`, `Cuentas con incidencias: ${failed.length}`, failed.length ? `\nPendientes:\n${failed.map((item) => `- ${item.clientName} (${item.source}): ${item.error || "No se pudo descargar"}`).join("\n")}` : "", "\nSe adjunta el informe PDF y todas las facturas en un ZIP."].filter(Boolean).join("\n");
  const archiveName = `facturas-gestoria-${run.periodKey}.zip`;
  const archiveKey = buildS3Key({ workspaceId: opts.workspaceId, targetType: "ACCOUNTANCY_RUN", targetId: run.id, filename: archiveName });
  await uploadBuffer({ s3Key: archiveKey, body: content, contentType: "application/zip" });
  const archiveUrl = await signedDownloadUrl(archiveKey, 14 * 24 * 3600);
  const emailBody = `${body}\n\nDescargar paquete completo (enlace válido durante 14 días):\n${archiveUrl}`;
  const sent = [];
  const cc = opts.ccRecipients?.join(", ") || undefined;
  for (const recipient of opts.recipients) sent.push((await sendEmailFromAccount({ userId: opts.userId, workspaceId: opts.workspaceId, to: recipient, cc, subject: `Facturas gestoría ${run.periodKey}`, body: emailBody })).messageId);
  await prisma.accountancyInvoiceRun.update({ where: { id: run.id }, data: { recipients: opts.recipients, ccRecipients: opts.ccRecipients ?? [], emailedAt: new Date(), archiveFiles: { deliveryStatus: "SENT", archiveName, archiveKey, sent } } });
  return sent;
}

export async function deliverScheduledAccountancyRun(runId: string) {
  const run = await prisma.accountancyInvoiceRun.findUnique({ where: { id: runId } });
  if (!run || run.trigger !== "SCHEDULED" || run.emailedAt || !["SUCCESS", "PARTIAL", "FAILED"].includes(run.status)) return null;
  const account = await prisma.emailAccount.findFirst({ where: { workspaceId: run.workspaceId }, orderBy: { updatedAt: "desc" } });
  if (!account) throw new Error("No hay una cuenta de correo configurada para el envío automático");
  const recipients = Array.isArray(run.recipients) ? run.recipients.map(String) : ["info@negociovivo.com"];
  const ccRecipients = Array.isArray(run.ccRecipients) ? run.ccRecipients.map(String) : [];
  return deliverAccountancyRun({ runId, workspaceId: run.workspaceId, userId: account.userId, recipients, ccRecipients });
}
