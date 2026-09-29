import { beforeEach, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({ model:{findUnique:vi.fn(),findMany:vi.fn(),upsert:vi.fn(),updateMany:vi.fn(),update:vi.fn()}, alert:vi.fn(),notify:vi.fn() }));
vi.mock('@/lib/db/prisma',()=>({prisma:{bubuiOperation:h.model}}));
vi.mock('../business-push',()=>({alertBusiness:h.alert}));
vi.mock('../notify',()=>({notifyBubuiCustomer:h.notify}));
import { deliverOperation } from '../operations';
it('reports an already accepted notice without sending it again',async()=>{
  h.model.findUnique.mockResolvedValue({id:'op1',status:'accepted'});
  expect(await deliverOperation('op1')).toBe(true);
  expect(h.alert).not.toHaveBeenCalled();
  expect(h.model.updateMany).not.toHaveBeenCalled();
});
beforeEach(()=>{vi.clearAllMocks();h.model.updateMany.mockResolvedValue({count:1});h.model.findUnique.mockResolvedValue({id:'op1',kind:'business_notice',businessId:'b1',status:'pending',payload:{type:'booking',message:'Ficticio'}});});
it('records failure for retry without losing the booking',async()=>{h.alert.mockRejectedValue(new Error('offline'));expect(await deliverOperation('op1')).toBe(false);expect(h.model.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'failed'})}));});
it('does not send an already claimed operation twice',async()=>{h.model.updateMany.mockResolvedValue({count:0});expect(await deliverOperation('op1')).toBe(false);expect(h.alert).not.toHaveBeenCalled();});
it('marks success only after the notice completes',async()=>{h.alert.mockResolvedValue(undefined);expect(await deliverOperation('op1')).toBe(true);expect(h.model.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'accepted'})}));});
