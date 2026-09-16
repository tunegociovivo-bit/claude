import { describe, expect, it, vi } from 'vitest';
import { createFleetPlan, dispatchFleetPlan } from '../mobile-fleet-dispatch';
const phones = [{deviceSerial:'one',phoneKey:'account-one',label:'Uno'}, {deviceSerial:'two',phoneKey:'account-two',label:'Dos'}];
describe('encargo común', () => {
  it('separa cuentas y conserva las instrucciones al cambiar la selección', async () => {
    let id=0; const targets = phones.map(p=>({...p})); const body={replyGuidance:'Texto',lookbackDays:30,deviceSerial:'incorrect'};
    const plan=createFleetPlan(targets,body,()=>`key-${++id}`); targets[0]!.phoneKey='changed'; body.lookbackDays=90;
    const submit=vi.fn(async()=>({id:`job-${id++}`,status:'QUEUED'}));
    await dispatchFleetPlan(plan,submit,()=>{});
    expect(submit.mock.calls.map(call=>(call as unknown as [Record<string,unknown>])[0])).toEqual([
      expect.objectContaining({deviceSerial:'one',phoneKey:'account-one',lookbackDays:30,idempotencyKey:'key-1'}),
      expect.objectContaining({deviceSerial:'two',phoneKey:'account-two',lookbackDays:30,idempotencyKey:'key-2'})
    ]);
  });
  it('continúa tras un error y reintenta únicamente el fallo con la misma clave',async()=>{
    let id=0;const plan=createFleetPlan(phones,{},()=>`key-${++id}`);
    const submit=vi.fn().mockRejectedValueOnce(new Error('Sin respuesta')).mockResolvedValueOnce({id:'job-two',status:'QUEUED'});
    const partial=await dispatchFleetPlan(plan,submit,()=>{});
    expect(partial.entries[0]!.error).toBe('Sin respuesta');expect(partial.entries[1]!.job?.id).toBe('job-two');
    const retry=vi.fn().mockResolvedValue({id:'job-one',status:'QUEUED'});
    const completed=await dispatchFleetPlan(partial,retry,()=>{});
    expect(retry).toHaveBeenCalledTimes(1); expect(retry).toHaveBeenCalledWith(expect.objectContaining({deviceSerial:'one',idempotencyKey:'key-1'}));
    expect(completed.entries.every(e=>e.job && !e.error)).toBe(true);
  });
  it('no da por creado un trabajo sin confirmación',async()=>{
    const plan=createFleetPlan([phones[0]!],{},()=> 'key');
    const result=await dispatchFleetPlan(plan,async()=>undefined as never,()=>{});
    expect(result.entries[0]!.job).toBeUndefined(); expect(result.entries[0]!.error).toContain('no confirmó');
  });
  it('rechaza destinos vacíos, duplicados o sin vincular',()=>{
    expect(()=>createFleetPlan([],{})).toThrow();
    expect(()=>createFleetPlan([phones[0]!,phones[0]!],{})).toThrow();
    expect(()=>createFleetPlan([{...phones[0]!,phoneKey:''}],{})).toThrow();
  });
});
