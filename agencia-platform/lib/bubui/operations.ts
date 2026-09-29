import { prisma } from '@/lib/db/prisma';
import { alertBusiness } from './business-push';
import { notifyBubuiCustomer } from './notify';

/** Claims prevent overlapping workers; ambiguous interruptions require manual review. */
export async function deliverOperation(id: string): Promise<boolean> {
  const op = await prisma.bubuiOperation.findUnique({ where: { id } });
  if (!op) return false;
  if (op.status === 'accepted') return true;
  const claimed = await prisma.bubuiOperation.updateMany({ where: { id, status: { in: ['pending', 'failed'] }, attempts: { lt: 5 } }, data: { status: 'processing', attempts: { increment: 1 }, updatedAt: new Date() } });
  if (claimed.count !== 1) return false;
  try {
    const payload = op.payload as any;
    if (op.kind === 'business_notice' && op.businessId) await alertBusiness(op.businessId, { ...payload, eventId: op.id });
    else if (op.kind === 'customer_notice' && op.customerId) {
      const result = await notifyBubuiCustomer(op.customerId, payload);
      if (!result.sent) throw new Error('no_delivery');
    } else throw new Error('invalid_operation');
    await prisma.bubuiOperation.update({ where: { id }, data: { status: 'accepted', lastError: null } });
    return true;
  } catch {
    await prisma.bubuiOperation.update({ where: { id }, data: { status: 'failed', lastError: 'No se pudo completar el aviso. Pendiente de reintento.', nextAttemptAt: new Date(Date.now() + 300000) } });
    return false;
  }
}

export async function recoverOperations(): Promise<number> {
  await prisma.bubuiOperation.updateMany({ where: { status: 'processing', updatedAt: { lt: new Date(Date.now() - 600000) } }, data: { status: 'uncertain', lastError: 'Envío interrumpido: comprobar antes de repetir.' } });
  const rows = await prisma.bubuiOperation.findMany({ where: { status: { in: ['pending', 'failed'] }, attempts: { lt: 5 }, nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: 50 });
  let accepted = 0;
  for (const row of rows) if (await deliverOperation(row.id)) accepted++;
  return accepted;
}
