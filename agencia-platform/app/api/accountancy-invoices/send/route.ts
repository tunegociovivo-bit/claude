import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { validateRecipients } from "@/lib/accountancy-invoices/domain";
import { sendEmailFromAccount } from "@/lib/integrations/email-account";
import { downloadBuffer, isStorageEnabled } from "@/lib/storage/r2";
import archiver from "archiver";

async function buildRunArchive(workspaceId: string, run: { id: string; periodKey: string; items: Array<{ files: unknown }> }) {
  if (!isStorageEnabled()) return null;
  const ids = run.items.flatMap((item) => Array.isArray(item.files) ? item.files.map((file: any) => file?.id).filter(Boolean) : []);
  if (!ids.length) return null;
  const files = await prisma.file.findMany({ where: { id: { in: ids }, workspaceId, targetType: "ACCOUNTANCY_RUN_ITEM" }, select: { id: true, name: true, s3Key: true, sizeBytes: true } });
  const maxArchiveBytes = 24 * 1024 * 1024;
  if (files.reduce((total, file) => total + file.sizeBytes, 0) > maxArchiveBytes) throw new Error("El paquete supera 24 MB. Divide la ejecución antes de enviarla.");
  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => { archive.on("data", (chunk: Buffer) => chunks.push(chunk)); archive.on("end", resolve); archive.on("error", reject); });
  const usedNames = new Set<string>();
  for (const file of files) {
    let name = file.name;
    for (let suffix = 2; usedNames.has(name); suffix++) name = file.name.replace(/(\.pdf)?$/i, `-${suffix}$1`);
    usedNames.add(name);
    archive.append(await downloadBuffer(file.s3Key), { name });
  }
  archive.finalize();
  await done;
  const content = Buffer.concat(chunks);
  if (content.length > maxArchiveBytes) throw new Error("El paquete supera 24 MB. Divide la ejecución antes de enviarla.");
  return { filename: `facturas-gestoria-${run.periodKey}.zip`, content, contentType: "application/zip" };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const member = await prisma.membership.findFirst({ where: { userId, workspaceId, role: "ADMIN" } });
  if (!member) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const body = await req.json();
  const recipients = validateRecipients(body.recipients);
  const run = await prisma.accountancyInvoiceRun.findFirst({ where: { id: body.runId, workspaceId }, include: { items: true } });
  if (!run) return NextResponse.json({ error: "Ejecución no encontrada" }, { status: 404 });
  const failed = run.items.filter((item) => item.status === "FAILED");
  const downloaded = run.items.reduce((sum, item) => sum + item.invoiceCount, 0);
  const bodyText = [
    `Documentación para gestoría - ${run.periodKey}`,
    "",
    `Facturas descargadas: ${downloaded}`,
    `Cuentas correctas: ${run.items.filter((item) => item.status === "DOWNLOADED").length}`,
    `Cuentas con incidencias: ${failed.length}`,
    failed.length ? `\nPendientes:\n${failed.map((item) => `- ${item.clientName} (${item.source}): ${item.error || "No se pudo descargar"}`).join("\n")}` : "",
    "\nSe adjunta un ZIP con todas las facturas archivadas en esta ejecución."
  ].filter(Boolean).join("\n");
  const attachment = await buildRunArchive(workspaceId, run);
  if (!attachment) return NextResponse.json({ error: "La ejecución todavía no contiene facturas archivadas" }, { status: 409 });
  const sent = [];
  for (const recipient of recipients) {
    const result = await sendEmailFromAccount({ userId, workspaceId, to: recipient, subject: `Facturas gestoría ${run.periodKey}`, body: bodyText, attachments: [attachment] });
    sent.push(result.messageId);
  }
  await prisma.accountancyInvoiceRun.update({ where: { id: run.id }, data: { recipients, emailedAt: new Date() } });
  return NextResponse.json({ ok: true, sent });
}
