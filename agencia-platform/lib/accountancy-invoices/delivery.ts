import archiver from "archiver";
import { prisma } from "@/lib/db/prisma";
import { sendEmailFromAccount } from "@/lib/integrations/email-account";
import { downloadBuffer, isStorageEnabled } from "@/lib/storage/r2";
import { buildAccountancyReport } from "./report";

export async function deliverAccountancyRun(opts: { runId: string; workspaceId: string; userId: string; recipients: string[] }) {
  const run = await prisma.accountancyInvoiceRun.findFirst({ where: { id: opts.runId, workspaceId: opts.workspaceId }, include: { items: true } });
  if (!run) throw new Error("Ejecución no encontrada");
  if (!isStorageEnabled()) throw new Error("Storage no configurado");
  const ids = run.items.flatMap((item) => Array.isArray(item.files) ? item.files.map((file: any) => file?.id).filter(Boolean) : []);
  if (!ids.length) throw new Error("La ejecución todavía no contiene facturas archivadas");
  const files = await prisma.file.findMany({ where: { id: { in: ids }, workspaceId: opts.workspaceId, targetType: "ACCOUNTANCY_RUN_ITEM" }, select: { name: true, s3Key: true, sizeBytes: true } });
  const maxBytes = 24 * 1024 * 1024;
  if (files.reduce((sum, file) => sum + file.sizeBytes, 0) > maxBytes) throw new Error("El paquete supera 24 MB");
  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => { archive.on("data", (chunk: Buffer) => chunks.push(chunk)); archive.on("end", resolve); archive.on("error", reject); });
  archive.append(await buildAccountancyReport(run.periodKey, run.items), { name: `Resumen-facturas-${run.periodKey}.pdf` });
  const names = new Set<string>();
  for (const file of files) {
    let name = file.name;
    for (let suffix = 2; names.has(name); suffix++) name = file.name.replace(/(\.pdf)?$/i, `-${suffix}$1`);
    names.add(name);
    archive.append(await downloadBuffer(file.s3Key), { name });
  }
  archive.finalize();
  await done;
  const content = Buffer.concat(chunks);
  if (content.length > maxBytes) throw new Error("El paquete supera 24 MB");
  const failed = run.items.filter((item) => item.status === "FAILED");
  const body = [`Documentación para gestoría - ${run.periodKey}`, "", `Facturas descargadas: ${run.items.reduce((sum, item) => sum + item.invoiceCount, 0)}`, `Cuentas correctas: ${run.items.filter((item) => item.status === "DOWNLOADED").length}`, `Cuentas con incidencias: ${failed.length}`, failed.length ? `\nPendientes:\n${failed.map((item) => `- ${item.clientName} (${item.source}): ${item.error || "No se pudo descargar"}`).join("\n")}` : "", "\nSe adjunta el informe PDF y todas las facturas en un ZIP."].filter(Boolean).join("\n");
  const attachment = { filename: `facturas-gestoria-${run.periodKey}.zip`, content, contentType: "application/zip" };
  const sent = [];
  for (const recipient of opts.recipients) sent.push((await sendEmailFromAccount({ userId: opts.userId, workspaceId: opts.workspaceId, to: recipient, subject: `Facturas gestoría ${run.periodKey}`, body, attachments: [attachment] })).messageId);
  await prisma.accountancyInvoiceRun.update({ where: { id: run.id }, data: { recipients: opts.recipients, emailedAt: new Date() } });
  return sent;
}

export async function deliverScheduledAccountancyRun(runId: string) {
  const run = await prisma.accountancyInvoiceRun.findUnique({ where: { id: runId } });
  if (!run || run.trigger !== "SCHEDULED" || run.emailedAt || !["SUCCESS", "PARTIAL", "FAILED"].includes(run.status)) return null;
  const account = await prisma.emailAccount.findFirst({ where: { workspaceId: run.workspaceId }, orderBy: { updatedAt: "desc" } });
  if (!account) throw new Error("No hay una cuenta de correo configurada para el envío automático");
  const recipients = Array.isArray(run.recipients) ? run.recipients.map(String) : ["info@negociovivo.com"];
  return deliverAccountancyRun({ runId, workspaceId: run.workspaceId, userId: account.userId, recipients });
}
