import { parseAndroidUiNodes } from './android-ui-hierarchy';
import { resolveAndroidUnlockPin } from '@/lib/mobile/unlock-pin';
export type UnlockDependencies = {
 run: (command: readonly string[])=>Promise<unknown>;
 read: ()=>Promise<string>;
 wait: (ms:number)=>Promise<void>;
 getPin: ()=>Promise<string>;
 isBlocked: ()=>boolean;
 block: ()=>void;
 clear: ()=>void;
};
export function androidKeyguardLocked(policy:string): boolean | null {
 const values=[...policy.matchAll(/\b(?:showing|mShowingLockscreen|isStatusBarKeyguard)\s*=\s*(true|false)\b/g)].map(m=>m[1]);
 return values.includes('true') ? true : values.length ? false : null;
}
export async function unlockAndroidForAutomation(d:UnlockDependencies):Promise<void> {
 await d.run(['input','keyevent','KEYCODE_WAKEUP']);
 await d.run(['wm','dismiss-keyguard']);
 await d.wait(400);
 const locked=androidKeyguardLocked(String(await d.run(['dumpsys','window','policy'])));
 if(locked===false) { d.clear(); return; }
 if(locked===null) throw new Error('No se puede confirmar el estado de bloqueo de Android. Desbloquea el móvil y vuelve a intentarlo.');
 if(d.isBlocked()) throw new Error('El último desbloqueo no se confirmó. Revisa el PIN y pulsa «Reintentar desbloqueo».');
 let nodes=parseAndroidUiNodes(await d.read());
 if(nodes.some(n=>/sim[_ ]?pin|pin de (?:la )?sim|sim card|puk/i.test(`${n.resourceId} ${n.text} ${n.contentDescription}`))) throw new Error('El móvil solicita el PIN de la SIM. Resuélvelo manualmente.');
 let entry=nodes.find(n=>n.packageName==='com.android.systemui' && /:id\/(?:pinEntry|pin_entry|passwordEntry|password_entry)$/i.test(n.resourceId));
 if(!entry) {
  const root=nodes.filter(n=>n.packageName==='com.android.systemui').sort((a,b)=>(b.bounds.right*b.bounds.bottom)-(a.bounds.right*a.bounds.bottom))[0];
  if(root && root.bounds.right>0 && root.bounds.bottom>0) {
   await d.run(['input','swipe',String(Math.round(root.bounds.right/2)),String(Math.round(root.bounds.bottom*.8)),String(Math.round(root.bounds.right/2)),String(Math.round(root.bounds.bottom*.3)),'350']);
   await d.wait(400); nodes=parseAndroidUiNodes(await d.read());
   entry=nodes.find(n=>n.packageName==='com.android.systemui' && /:id\/(?:pinEntry|pin_entry)$/i.test(n.resourceId));
  }
 }
 // Only a numeric lock-screen field may receive the credential, never an app or SIM prompt.
 if(!entry || !/:id\/(?:pinEntry|pin_entry)$/i.test(entry.resourceId)) throw new Error('No se ha identificado el teclado PIN del bloqueo de Android. Desbloquea el móvil manualmente.');
 if(nodes.some(n=>/sim[_ ]?pin|pin de (?:la )?sim|puk|demasiados intentos|too many attempts|inténtalo de nuevo en|try again in/i.test(`${n.resourceId} ${n.text}`))) throw new Error('Android requiere intervención antes de desbloquear.');
 const pin=resolveAndroidUnlockPin(await d.getPin());
 d.block(); // Persist before entering anything: network failures and job retries must not guess again.
 try {
  await d.run(['input','tap',String(entry.center.x),String(entry.center.y)]);
  await d.run(['input','keyevent','KEYCODE_MOVE_END']);
  await d.run(['input','keyevent',...Array(16).fill('KEYCODE_DEL')]);
  const current = parseAndroidUiNodes(await d.read());
  const stillLocked = androidKeyguardLocked(String(await d.run(['dumpsys','window','policy'])));
  if(stillLocked!==true || !current.some(n=>n.packageName==='com.android.systemui' && n.resourceId===entry.resourceId)) throw new Error('El bloqueo cambió antes de introducir el PIN.');
  await d.run(['input','text',pin]);
  await d.wait(300);
  if(androidKeyguardLocked(String(await d.run(['dumpsys','window','policy'])))!==false) await d.run(['input','keyevent','KEYCODE_ENTER']);
  for(let i=0;i<5;i++) { await d.wait(400); if(androidKeyguardLocked(String(await d.run(['dumpsys','window','policy'])))===false) { d.clear(); return; } }
 } catch { throw new Error('No se pudo confirmar el desbloqueo. Revisa el PIN antes de reintentar.'); }
 throw new Error('Android sigue bloqueado. Revisa el PIN antes de reintentar.');
}
