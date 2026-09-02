import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { validateRecipients } from "@/lib/accountancy-invoices/domain";
import { sendEmailFromAccount } from "@/lib/integrations/email-account";

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
  const archives = Array.isArray(run.archiveFiles) ? run.archiveFiles as Array<{ name?: string; url?: string }> : [];
  const links = archives.filter((file) => file.url).map((file) => `${file.name || "Paquete"}: ${file.url}`).join("\n");
  const bodyText = [
    `Documentación para gestoría - ${run.periodKey}`,
    "",
    `Facturas descargadas: ${downloaded}`,
    `Cuentas correctas: ${run.items.filter((item) => item.status === "DOWNLOADED").length}`,
    `Cuentas con incidencias: ${failed.length}`,
    failed.length ? `\nPendientes:\n${failed.map((item) => `- ${item.clientName} (${item.source}): ${item.error || "No se pudo descargar"}`).join("\n")}` : "",
    links ? `\nPaquetes:\n${links}` : "\nLos paquetes estarán disponibles en el Hub cuando finalice el agente de descarga."
  ].filter(Boolean).join("\n");
  const result = await sendEmailFromAccount({ userId, workspaceId, to: recipients.join(","), subject: `Facturas gestoría ${run.periodKey}`, body: bodyText });
  await prisma.accountancyInvoiceRun.update({ where: { id: run.id }, data: { recipients, emailedAt: new Date() } });
  return NextResponse.json({ ok: true, ...result });
}
