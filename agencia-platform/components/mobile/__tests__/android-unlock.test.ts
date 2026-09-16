import {describe,it,expect,vi} from 'vitest';
import {androidKeyguardLocked,unlockAndroidForAutomation,type UnlockDependencies} from '../android-unlock';
import {resolveAndroidUnlockPin} from '@/lib/mobile/unlock-pin';
const pinScreen='<hierarchy><node package="com.android.systemui" resource-id="com.android.systemui:id/pinEntry" class="android.widget.EditText" bounds="[10,10][100,100]" /></hierarchy>';
function deps(): UnlockDependencies {
 return {run:vi.fn(async()=> 'showing=true'),read:vi.fn(async()=>pinScreen),wait:vi.fn(async()=>{}),getPin:vi.fn(async()=>''),isBlocked:vi.fn(()=>false),block:vi.fn(),clear:vi.fn()};
}
describe('desbloqueo Android',()=>{
 it('usa el predeterminado y conserva ceros iniciales',()=>{expect(resolveAndroidUnlockPin('')).toBe('1608');expect(resolveAndroidUnlockPin('0012')).toBe('0012');expect(()=>resolveAndroidUnlockPin('12;cmd')).toThrow();});
 it('distingue estado desconocido del teléfono desbloqueado',()=>{expect(androidKeyguardLocked('other=false')).toBeNull();expect(androidKeyguardLocked('showing=false')).toBe(false);expect(androidKeyguardLocked('isStatusBarKeyguard=true')).toBe(true);});
 it('no recupera ni escribe PIN si el teléfono ya está desbloqueado',async()=>{const d=deps();vi.mocked(d.run).mockResolvedValue('showing=false');await unlockAndroidForAutomation(d);expect(d.getPin).not.toHaveBeenCalled();expect(d.read).not.toHaveBeenCalled();});
 it('introduce el PIN una vez y comprueba que desaparece el bloqueo',async()=>{
  const d=deps();let entered=false;vi.mocked(d.run).mockImplementation(async c=>{if(c[1]==='text') entered=true;return entered?'showing=false':'showing=true';});
  await unlockAndroidForAutomation(d);expect(d.run).toHaveBeenCalledWith(['input','text','1608']);expect(d.block).toHaveBeenCalledOnce();expect(d.clear).toHaveBeenCalledOnce();
 });
 it('no repite un intento rechazado aunque el trabajo se reintente',async()=>{
  const d=deps();let blocked=false;d.block=()=>{blocked=true;};d.isBlocked=()=>blocked;
  await expect(unlockAndroidForAutomation(d)).rejects.toThrow('sigue bloqueado');
  await expect(unlockAndroidForAutomation(d)).rejects.toThrow('último desbloqueo');
  expect(vi.mocked(d.run).mock.calls.filter(([c])=>c[1]==='text')).toHaveLength(1);
 });
 it('nunca escribe el PIN en una app ni en el diálogo SIM',async()=>{
  for(const xml of [pinScreen.replaceAll('com.android.systemui','com.facebook.katana'),pinScreen.replace('pinEntry','simPinEntry')]) {
   const d=deps();vi.mocked(d.read).mockResolvedValue(xml);await expect(unlockAndroidForAutomation(d)).rejects.toThrow();expect(d.getPin).not.toHaveBeenCalled();
  }
 });
 it('no incluye credenciales en los errores del dispositivo',async()=>{
  const d=deps();vi.mocked(d.run).mockImplementation(async c=>{if(c[1]==='text')throw new Error('input text 1608 failed');return 'showing=true';});
  await expect(unlockAndroidForAutomation(d)).rejects.toThrow('No se pudo confirmar');
 });
});
