import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { customerAuthOk, customerIdFromAuth } from '@/lib/bubui/customer-auth';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const customerId = customerIdFromAuth(req);
  if (!customerId || !(await customerAuthOk(req, customerId))) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  const secret = req.headers.get('authorization')!.trim().split(':')[1];
  await prisma.$transaction(async tx => {
    const revoked = await tx.bubuiCustomer.updateMany({ where: { id: customerId, apiToken: secret }, data: { apiToken: null, pushToken: null } });
    if (revoked.count !== 1) throw new Error('session_changed');
    await tx.bubuiMobilePushToken.deleteMany({ where: { customerId } });
    await tx.bubuiPushSubscription.deleteMany({ where: { customerId } });
  });
  return NextResponse.json({ ok: true });
}
