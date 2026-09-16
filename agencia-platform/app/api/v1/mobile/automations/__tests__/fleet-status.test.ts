import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({findMany:vi.fn(),policy:vi.fn(),access:vi.fn()}));
vi.mock('@/lib/api/handler',()=>({withApi: (_: unknown, handler: unknown)=>handler}));
vi.mock('@/lib/db/prisma',()=>({prisma:{mobileAutomationJob:{findMany:mocks.findMany},mobileAutomationPolicy:{findUnique:mocks.policy}}}));
vi.mock('@/lib/mobile/automation-access',()=>({loadMobileAutomationAccess:mocks.access}));
import { GET } from '../route';
const get=GET as unknown as (req: Request, ctx: unknown)=>Promise<Response>;
describe('estado de encargos comunes',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.findMany.mockResolvedValue([]);mocks.policy.mockResolvedValue(null);mocks.access.mockResolvedValue({canManage:false});});
 it('limita los identificadores al espacio autorizado y conserva los permisos',async()=>{
  const response=await get(new Request('https://hub.test/api?jobIds=job-one,job-two'),{api:{workspaceId:'authorized',userId:'viewer'}});
  expect(mocks.access).toHaveBeenCalledWith('authorized','viewer');
  expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{workspaceId:'authorized',id:{in:['job-one','job-two']}},take:2}));
  expect((await response.json()).canManage).toBe(false);
 });
 it('rechaza consultas sin identificadores o con demasiados',async()=>{
  for(const ids of ['',Array(101).fill('id').join(',')]) expect((await get(new Request(`https://hub.test/api?jobIds=${ids}`),{api:{workspaceId:'authorized',userId:'viewer'}})).status).toBe(400);
  expect(mocks.findMany).not.toHaveBeenCalled();
 });
});
