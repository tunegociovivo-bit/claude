import {beforeEach,describe,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({access:vi.fn(),linked:vi.fn(),encrypt:vi.fn(),decrypt:vi.fn(),find:vi.fn(),update:vi.fn()}));
vi.mock('@/lib/api/handler',()=>({withApi:(_:unknown,handler:unknown)=>handler}));
vi.mock('@/lib/mobile/automation-access',()=>({loadMobileAutomationAccess:m.access,requireSerialLinkedToWorkspace:m.linked}));
vi.mock('@/lib/ai/crypto',()=>({encryptSecret:m.encrypt,decryptSecret:m.decrypt}));
vi.mock('@/lib/db/prisma',()=>({prisma:{$transaction:(fn:(tx:unknown)=>unknown)=>fn({workspace:{findUnique:m.find,update:m.update}})}}));
import {POST} from '../route';
const post=POST as unknown as (req:Request,context:unknown)=>Promise<Response>;
const call=(action:string,pin?:string)=>post(new Request('https://hub.test/api',{method:'POST',body:JSON.stringify({deviceSerial:'one',action,...(pin!==undefined?{pin}:{})})}),{api:{workspaceId:'workspace',userId:'admin'}});
describe('PIN por teléfono',()=>{
 beforeEach(()=>{vi.resetAllMocks();m.access.mockResolvedValue({workspace:{settings:{}},phones:[]});m.find.mockResolvedValue({settings:{mobileUnlockPins:{two:'other-encrypted'},unrelated:true}});m.encrypt.mockReturnValue('encrypted');});
 it('requiere gestión y asociación del dispositivo antes de recuperar el PIN',async()=>{const response=await call('resolve');expect(m.access).toHaveBeenCalledWith('workspace','admin',{manager:true});expect(m.linked).toHaveBeenCalledWith([],'one');expect(await response.json()).toEqual({pin:'1608'});expect(response.headers.get('Cache-Control')).toBe('no-store');});
 it('guarda cifrado sin modificar el otro teléfono ni devolver el PIN',async()=>{const response=await call('save','0012');expect(m.encrypt).toHaveBeenCalledWith('0012');expect(m.update).toHaveBeenCalledWith({where:{id:'workspace'},data:{settings:{mobileUnlockPins:{one:'encrypted',two:'other-encrypted'},unrelated:true}}});expect(await response.json()).toEqual({custom:true});});
 it('vacío restablece el predeterminado, sin guardar el valor en claro',async()=>{await call('save','');expect(m.encrypt).not.toHaveBeenCalled();expect(m.update).toHaveBeenCalledWith(expect.objectContaining({data:{settings:{mobileUnlockPins:{two:'other-encrypted'},unrelated:true}}}));});
 it('status no devuelve el PIN y un cifrado ilegible no usa el predeterminado',async()=>{m.access.mockResolvedValue({workspace:{settings:{mobileUnlockPins:{one:'cipher'}}},phones:[]});expect(await (await call('status')).json()).toEqual({custom:true});m.decrypt.mockReturnValue(null);await expect(call('resolve')).rejects.toThrow('No se puede recuperar');});
 it('no permite acceso sin autorización ni sin móvil vinculado',async()=>{m.access.mockRejectedValueOnce(new Error('forbidden'));await expect(call('resolve')).rejects.toThrow('forbidden');m.linked.mockImplementationOnce(()=>{throw new Error('unlinked');});await expect(call('save','1234')).rejects.toThrow('unlinked');expect(m.update).not.toHaveBeenCalled();});
});
