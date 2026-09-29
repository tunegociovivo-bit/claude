import { expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({offers:{findFirst:vi.fn(),update:vi.fn(),updateMany:vi.fn().mockResolvedValue({count:0})}}));
vi.mock('@/lib/db/prisma',()=>({prisma:{bubuiOffer:h.offers}}));
vi.mock('@/lib/bubui/auth',()=>({businessTokenAllows:vi.fn().mockResolvedValue(true)}));
import {POST} from '@/app/api/bubui/business/[id]/pending-proofs/route';
it('cannot approve a consumed or no longer provisional offer',async()=>{
 h.offers.findFirst.mockResolvedValue({id:'used'});
 const response=await POST(new Request('http://localhost/api/proofs',{method:'POST',body:JSON.stringify({kind:'challenge',refId:'used',action:'approve'})}),{params:Promise.resolve({id:'business'})});
 expect(response.status).toBe(409);
 expect(h.offers.update).not.toHaveBeenCalled();
 expect(h.offers.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({redeemed:false,activatedProvisional:true})}));
});
