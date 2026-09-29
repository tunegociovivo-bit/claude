import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { businessTokenAllows } from '@/lib/bubui/auth';
import { deliverOperation } from '@/lib/bubui/operations';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get('authorization'), params.id))) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  const [notices, ads, purchases, pendingProofs] = await Promise.all([
    prisma.bubuiOperation.findMany({ where: { businessId: params.id, status: { not: 'accepted' } }, select: { id: true, status: true, attempts: true, lastError: true, createdAt: true, kind: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.bubuiPushAd.findMany({ where: { businessId: params.id, status: { in: ['failed', 'sending'] } }, select: { id: true, title: true, status: true }, take: 50 }),
    prisma.bubuiPurchase.findMany({ where: { businessId: params.id, OR: [{ status: 'pending' }, { status: 'confirmed', challengeProcessedAt: null }] }, select: { id: true, status: true, amount: true, scannedAt: true, confirmedAt: true }, orderBy: { scannedAt: 'desc' }, take: 50 }),
    prisma.bubuiOffer.count({ where: { businessId: params.id, activatedProvisional: true, redeemed: false } }),
  ]);
  return NextResponse.json({ notices, ads, purchases, pendingProofs });
}
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get('authorization'), params.id))) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (typeof body?.id !== 'string') return NextResponse.json({ error: { code: 'validation' } }, { status: 400 });
  const op = await prisma.bubuiOperation.findFirst({ where: { id: body.id, businessId: params.id, status: 'failed', kind: { in: ['business_notice', 'customer_notice'] } } });
  if (!op) return NextResponse.json({ error: { code: 'not_retryable' } }, { status: 409 });
  await prisma.bubuiOperation.updateMany({ where: { id: op.id, status: 'failed' }, data: { attempts: 0, nextAttemptAt: new Date() } });
  return NextResponse.json({ ok: await deliverOperation(op.id) });
}
