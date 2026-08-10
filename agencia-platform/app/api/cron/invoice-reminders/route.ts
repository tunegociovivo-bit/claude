import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { cronAuthOk } from "@/lib/cron-auth";
import { deliverInvoice } from "@/lib/invoicing/invoice-delivery";
import { getInvoiceReminderKey, invoiceRecipient } from "@/lib/invoicing/invoice-email";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!cronAuthOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = new Date();
  const enabled = await prisma.workspace.findMany({
    where: { invoiceRemindersEnabled: true },
    select: { id: true }
  });
  let sent = 0;
  let skipped = 0;
  const errors: { invoiceId: string; error: string }[] = [];

  for (const workspace of enabled) {
    const invoices = await prisma.invoice.findMany({
      where: {
        workspaceId: workspace.id,
        status: "ISSUED",
        deletedAt: null,
        dueDate: {
          gte: new Date(now.getTime() - 16 * 86_400_000),
          lte: new Date(now.getTime() + 4 * 86_400_000)
        }
      },
      include: { client: { select: { email: true } } }
    });
    for (const invoice of invoices) {
      if (invoice.paidCents >= invoice.totalCents) continue;
      const reminderKey = getInvoiceReminderKey(invoice.dueDate, now);
      const recipient = invoiceRecipient(invoice.client, invoice.clientSnapshot);
      if (!reminderKey || !recipient) continue;
      try {
        await deliverInvoice({
          workspaceId: workspace.id,
          invoiceId: invoice.id,
          recipient,
          kind: "REMINDER",
          reminderKey,
          dedupeKey: `reminder:${invoice.id}:${reminderKey}:${recipient}`
        });
        sent++;
      } catch (error: any) {
        if (error?.code === "already_sent") skipped++;
        else errors.push({ invoiceId: invoice.id, error: String(error?.message ?? error).slice(0, 200) });
      }
    }
  }
  return NextResponse.json({ ok: true, enabledWorkspaces: enabled.length, sent, skipped, errors });
}
