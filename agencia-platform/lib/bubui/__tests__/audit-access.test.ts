import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  customer: { findUnique: vi.fn(), create: vi.fn() },
  business: { findUnique: vi.fn() }, push: { upsert: vi.fn() },
  upload: vi.fn(), vision: vi.fn(), access: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: { bubuiCustomer: h.customer, bubuiBusiness: h.business, bubuiPushSubscription: h.push } }));
vi.mock('@/lib/storage/r2', () => ({ isStorageEnabled: () => true, uploadBuffer: h.upload, signedDownloadUrl: vi.fn() }));
vi.mock('@/lib/ai/anthropic', () => ({ completeVision: h.vision }));
vi.mock('@/lib/bubui/business-referral', () => ({ hasVivoStudioAccess: h.access }));
import { customerAuthOk } from '../customer-auth';
import { businessTokenAllows } from '../auth';
import { POST as signup } from '@/app/api/bubui/customer/signup/route';
import { POST as push } from '@/app/api/bubui/push/subscribe/route';
import { POST as ticket } from '@/app/api/bubui/scan/read-ticket/route';
import { POST as studio } from '@/app/api/bubui/ai-studio/push-copy/route';
const req = (body: unknown, auth?: string) => new Request('https://example.test', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); h.access.mockResolvedValue({ eligible: false }); h.customer.findUnique.mockResolvedValue({ id: 'c1', apiToken: 'secret' }); h.business.findUnique.mockResolvedValue({ apiToken: null }); });
describe('closed access boundaries', () => {
  it.each([null, 'Bearer malformed', 'Bearer other:secret', 'Bearer c1:wrong'])('rejects customer credential %s', async auth => {
    expect(await customerAuthOk(req({}, auth ?? undefined), 'c1')).toBe(false);
  });
  it('allows an authenticated customer', async () => expect(await customerAuthOk(req({}, 'Bearer c1:secret'), 'c1')).toBe(true));
  it('rejects a legacy business without a stored secret', async () => expect(await businessTokenAllows('Bearer b1:anything', 'b1')).toBe(false));
  it('legacy signup cannot disclose or create accounts without verification', async () => {
    const response = await signup(req({ email: 'fake@example.test' }));
    expect(response.status).toBe(410);
    expect(h.customer.findUnique).not.toHaveBeenCalled(); expect(h.customer.create).not.toHaveBeenCalled();
  });
  it('anonymous push registration cannot write', async () => {
    const response = await push(req({ customerId: 'c1', subscription: { endpoint: 'https://example.test/push', keys: { p256dh: 'fictionalkey123', auth: 'fictional' } } }));
    expect(response.status).toBe(401); expect(h.push.upsert).not.toHaveBeenCalled();
  });
  it('anonymous OCR cannot upload or call AI', async () => {
    const form = new FormData(); form.set('file', new Blob(['fake'], { type: 'image/jpeg' }), 'fake.jpg');
    expect((await ticket(new Request('https://example.test', { method: 'POST', body: form }))).status).toBe(401);
    expect(h.upload).not.toHaveBeenCalled(); expect(h.vision).not.toHaveBeenCalled();
  });
  it('studio checks session before paid entitlement or AI', async () => {
    expect((await studio(req({ businessId: 'b1', productOrOffer: 'Oferta ficticia' }))).status).toBe(401);
    expect(h.access).not.toHaveBeenCalled();
  });
});

