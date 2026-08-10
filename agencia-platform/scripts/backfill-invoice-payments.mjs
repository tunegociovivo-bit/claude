import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const invoices = await prisma.invoice.findMany({
    where: { paidCents: { gt: 0 } },
    select: { id: true }
  });

  for (const invoice of invoices) {
    const paymentId = `legacy_payment_${invoice.id}`;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${invoice.id}))`;
      const fresh = await tx.invoice.findUnique({
        where: { id: invoice.id },
        select: {
          id: true,
          workspaceId: true,
          paidCents: true,
          currency: true,
          paidAt: true,
          updatedAt: true,
          paymentMethod: true
        }
      });
      if (!fresh || fresh.paidCents <= 0) return;
      const existingMovements = await tx.invoicePayment.count({ where: { invoiceId: invoice.id } });
      if (existingMovements > 0) return;
      await tx.invoicePayment.upsert({
        where: { id: paymentId },
        create: {
          id: paymentId,
          workspaceId: fresh.workspaceId,
          invoiceId: fresh.id,
          amountCents: fresh.paidCents,
          currency: fresh.currency,
          occurredAt: fresh.paidAt ?? fresh.updatedAt,
          method: fresh.paymentMethod,
          notes: "Saldo migrado del sistema anterior"
        },
        update: {}
      });
      await tx.invoiceEvent.upsert({
        where: { id: `legacy_event_${invoice.id}` },
        create: {
          id: `legacy_event_${invoice.id}`,
          workspaceId: fresh.workspaceId,
          invoiceId: fresh.id,
          type: "PAYMENT_BALANCE_MIGRATED",
          data: { paidCents: fresh.paidCents }
        },
        update: {}
      });
    });
  }
  console.log(`[invoice-ledger] ${invoices.length} saldos históricos verificados`);
} finally {
  await prisma.$disconnect();
}
