"use client";
import { useEffect, useState } from 'react';
export async function mobileUnlockPinRequest(deviceSerial:string, action:'status'|'save'|'resolve', pin?:string) {
 const response=await fetch('/api/v1/mobile/devices/unlock-pin',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceSerial,action,...(pin!==undefined?{pin}:{})})});
 const data=await response.json();
 if(!response.ok) throw new Error(data?.error?.message ?? 'No se pudo acceder al PIN de este móvil.');
 return data as {custom?:boolean;pin?:string};
}
export default function MobileUnlockPinField({deviceSerial,ready,onSaved,onUnlock}:{deviceSerial:string;ready:boolean;onSaved:()=>void;onUnlock:()=>Promise<void>}) {
 const [pin,setPin]=useState(''); const [custom,setCustom]=useState<boolean|null>(null); const [dirty,setDirty]=useState(false);
 const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
 useEffect(()=>{let active=true;void mobileUnlockPinRequest(deviceSerial,'status').then(data=>{if(active)setCustom(!!data.custom);}).catch(()=>{if(active)setMessage('No se pudo consultar el PIN guardado.');});return()=>{active=false;};},[deviceSerial]);
 async function save(value:string) {
  setBusy(true);setMessage('');
  try {const data=await mobileUnlockPinRequest(deviceSerial,'save',value);setCustom(!!data.custom);setPin('');setDirty(false);onSaved();setMessage('PIN guardado para este teléfono.');}
  catch(e){setMessage(e instanceof Error?e.message:'No se pudo guardar el PIN.');}finally{setBusy(false);}
 }
 return <section aria-label="PIN de desbloqueo" className="rounded-xl border bg-slate-50 p-3">
  <form onSubmit={event=>{event.preventDefault();void save(pin);}} className="space-y-2">
   <label className="block text-xs font-semibold text-slate-700">PIN de desbloqueo del teléfono
    <input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,16}" maxLength={16} value={pin} onChange={e=>{setPin(e.target.value);setDirty(true);}} placeholder={custom?'PIN personalizado guardado':'1608'} className="mt-1 w-full rounded-lg border bg-white p-2 text-sm" />
   </label>
   <p className="text-xs text-slate-600">{custom===null?'Consultando configuración…':custom?'Este teléfono usa un PIN personalizado.':'Este teléfono usa el PIN predeterminado: 1608.'} Si guardas el campo vacío, se usará 1608.</p>
   <div className="flex flex-wrap gap-2 text-xs">
    <button type="submit" disabled={busy||!dirty} className="rounded-lg bg-indigo-700 px-3 py-2 font-semibold text-white disabled:opacity-50">Guardar PIN</button>
    {custom && <button type="button" disabled={busy} onClick={()=>void save('')} className="rounded-lg border px-3 py-2">Usar 1608</button>}
    <button type="button" disabled={busy||!ready||dirty} onClick={async()=>{setBusy(true);setMessage('');try{await onUnlock();setMessage('Teléfono desbloqueado.');}catch(e){setMessage(e instanceof Error?e.message:'No se pudo desbloquear.');}finally{setBusy(false);}}} className="rounded-lg border px-3 py-2 disabled:opacity-50">Reintentar desbloqueo</button>
   </div>
   {message && <p role="status" className="text-xs text-slate-700">{message}</p>}
  </form>
 </section>;
}
