import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => { const m=()=>({ findUnique: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() }); return { prisma: { bubuiCustomer: m(), bubuiMobilePushToken: m(), bubuiPushSubscription: m(), $transaction: vi.fn() }, auth: vi.fn(), remove: vi.fn() }; });
vi.mock('@/lib/db/prisma',()=>({prisma:h.prisma}));
vi.mock('@/lib/bubui/customer-auth',()=>({customerAuthOk:h.auth,customerIdFromAuth:()=> 'c1'}));
vi.mock('@/lib/storage/r2',()=>({deleteObject:h.remove}));
import { POST as logout } from '@/app/api/bubui/customer/logout/route';
import { ownedMediaKey } from '../customer-media';
beforeEach(()=>{vi.clearAllMocks();h.auth.mockResolvedValue(true);h.prisma.bubuiCustomer.updateMany.mockResolvedValue({count:1});h.prisma.$transaction.mockImplementation(async (fn:any)=>fn(h.prisma));});
it('logout revokes the credential and notification associations atomically',async()=>{
  const response=await logout(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer c1:test'}}));
  expect(response.status).toBe(200);expect(h.prisma.$transaction).toHaveBeenCalled();expect(h.prisma.bubuiMobilePushToken.deleteMany).toHaveBeenCalledWith({where:{customerId:'c1'}});expect(h.prisma.bubuiPushSubscription.deleteMany).toHaveBeenCalledWith({where:{customerId:'c1'}});
});
it('logout rejects unverified sessions',async()=>{h.auth.mockResolvedValue(false);expect((await logout(new Request('https://example.test',{method:'POST'}))).status).toBe(401);expect(h.prisma.$transaction).not.toHaveBeenCalled();});
it('media cleanup never accepts arbitrary URLs or another account',()=>{
  expect(ownedMediaKey('https://foreign.test/bubui/tickets/c1/photo.jpg','c1',[],[])).toBeNull();
  process.env.STORAGE_PUBLIC_URL='https://assets.example.test';
  expect(ownedMediaKey('https://assets.example.test/bubui/tickets/c1/photo.jpg','c1',[],[])).toBe('bubui/tickets/c1/photo.jpg');
  expect(ownedMediaKey('https://assets.example.test/bubui/tickets/c2/photo.jpg','c1',[],[])).toBeNull();
  delete process.env.STORAGE_PUBLIC_URL;
});
