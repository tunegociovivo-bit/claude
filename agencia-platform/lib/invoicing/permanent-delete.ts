export async function permanentlyDeleteInvoice(db: any, workspaceId: string, invoiceId: string): Promise<void> {
  await db.$transaction(async (tx: any) => {
    const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, workspaceId } });
    if (!invoice) throw new Error("Factura no encontrada");
    if (!invoice.deletedAt) throw new Error("La factura debe estar en la papelera antes de eliminarla definitivamente");

    await tx.bankTransaction.updateMany({
      where: { workspaceId, matchedInvoiceId: invoiceId },
      data: { matchedInvoiceId: null, status: "UNMATCHED", matchConfidence: null, matchedAt: null }
    });

    const jobs = await tx.remittanceJob.findMany({ where: { workspaceId, invoiceId }, select: { id: true } });
    if (jobs.length) await tx.remittanceJobEvent.deleteMany({ where: { jobId: { in: jobs.map((job: any) => job.id) } } });
    await tx.remittanceJob.deleteMany({ where: { workspaceId, invoiceId } });

    const requests = await tx.sepaRemittanceRequest.findMany({ where: { workspaceId, invoiceId }, select: { id: true } });
    if (requests.length) await tx.sepaRemittanceEvent.deleteMany({ where: { requestId: { in: requests.map((request: any) => request.id) } } });
    await tx.sepaRemittanceRequest.deleteMany({ where: { workspaceId, invoiceId } });

    await tx.invoice.updateMany({ where: { workspaceId, rectifiesInvoiceId: invoiceId }, data: { rectifiesInvoiceId: null } });
    await tx.invoice.updateMany({ where: { workspaceId, recurringSourceId: invoiceId }, data: { recurringSourceId: null } });
    await tx.invoice.delete({ where: { id: invoiceId } });
  });
}
