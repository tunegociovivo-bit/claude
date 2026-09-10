import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { validateRecipients } from "@/lib/accountancy-invoices/domain";
import { deliverAccountancyRun } from "@/lib/accountancy-invoices/delivery";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const member = await prisma.membership.findFirst({ where: { userId, workspaceId, role: "ADMIN" } });
  if (!member) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const body = await req.json();
  const recipients = validateRecipients(body.recipients);
  try {
    const runId = String(body.runId || "");
    const run = await prisma.accountancyInvoiceRun.findFirst({ where: { id: runId, workspaceId }, select: { id: true } });
    if (!run) return NextResponse.json({ error: "Ejecución no encontrada" }, { status: 404 });
    await prisma.accountancyInvoiceRun.update({ where: { id: run.id }, data: { recipients, archiveFiles: { deliveryStatus: "SENDING", startedAt: new Date().toISOString() } } });
    void deliverAccountancyRun({ runId, workspaceId, userId, recipients }).catch(async (error) => {
      await prisma.accountancyInvoiceRun.update({ where: { id: run.id }, data: { archiveFiles: { deliveryStatus: "FAILED", error: String(error?.message || error).slice(0, 500) } } }).catch(() => {});
    });
    return NextResponse.json({ ok: true, status: "SENDING" }, { status: 202 });
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 409 });
  }
}
