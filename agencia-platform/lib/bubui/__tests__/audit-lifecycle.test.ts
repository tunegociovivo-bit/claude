import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => {
  const m = () => ({ findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() });
  return { prisma: { bubuiCustomer: m(), bubuiBusiness: m(), bubuiMobilePushToken: m(), bubuiPushSubscription: m(), bubuiPushLog: m(), $transaction: vi.fn() }, web: vi.fn(), mobile: vi.fn(), cap: vi.fn(), record: vi.fn() };
});
vi.mock('@/lib/db/prisma', () => ({ prisma: h.prisma }));
vi.mock('@/lib/bubui/push', () => ({ sendPushToBubuiCustomer: h.web }));
vi.mock('@/lib/bubui/expo-push', () => ({ sendMobilePushToCustomer: h.mobile }));
vi.mock('@/lib/bubui/push-cap', () => ({ canReceivePush: h.cap, recordPushSent: h.record }));
vi.mock('@/lib/bubui/topcategory', () => ({ getTopBusinessIds: async () => new Set() }));
import { notifyBubuiCustomer } from '../notify';
import { GET as discover } from '@/app/api/bubui/discover/route';
beforeEach(() => { vi.clearAllMocks(); h.cap.mockResolvedValue(true); h.web.mockResolvedValue({ sent: 0 }); h.mobile.mockResolvedValue({ sent: 1 }); h.prisma.bubuiBusiness.findMany.mockResolvedValue([]); });
it('records a mobile-only notification for cross-channel deduplication', async () => {
  await notifyBubuiCustomer('c1', { title: 'Ficticio', body: 'Ficticio', tag: 'expiring_4h' });
  expect(h.prisma.bubuiPushLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ customerId: 'c1', kind: 'expiring_4h' }) }));
});
it('invalid coordinates and pagination are rejected', async () => {
  expect((await discover(new Request('https://example.test?lat=999&lng=no&limit=NaN'))).status).toBe(400);
  expect(h.prisma.bubuiBusiness.findMany).not.toHaveBeenCalled();
});
it('nearby discovery does not discard candidates before distance sorting', async () => {
  await discover(new Request('https://example.test?lat=36.7&lng=-4.5'));
  const call = h.prisma.bubuiBusiness.findMany.mock.calls[0][0];
  expect(call.take).toBeUndefined();
  expect(call.where.latitude).toBeDefined();
});
