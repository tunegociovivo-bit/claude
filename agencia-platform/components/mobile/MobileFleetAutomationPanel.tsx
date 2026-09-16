"use client";
import { useEffect, useRef, useState } from "react";
import MobileAutomationPanel from "./MobileAutomationPanel";
import { createFleetPlan, dispatchFleetPlan, type FleetPlan, type FleetTarget } from "./mobile-fleet-dispatch";
const labels: Record<string,string> = { QUEUED: "En cola", RUNNING: "En ejecución", PENDING_APPROVAL: "Pendiente de aprobación", WAITING_USER: "Necesita revisión", COMPLETED: "Completado", FAILED: "Ha fallado", CANCELLED: "Cancelado", REJECTED: "Rechazado" };
type Device = Omit<FleetTarget, 'phoneKey'> & { phoneKey?: string };
export default function MobileFleetAutomationPanel({ devices, canManage, onOpen }: { devices: Device[]; canManage: boolean; onOpen: (serials: string[]) => void }) {
  const [excluded, setExcluded] = useState<string[]>([]);
  const [plan, setPlan] = useState<FleetPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const lock = useRef(false);
  const selected = devices.filter(d => d.phoneKey && !excluded.includes(d.deviceSerial));
  const ids = plan?.entries.flatMap(e => e.job ? [e.job.id] : []).join(',') ?? '';
  useEffect(() => {
    if (!ids) return;
    let disposed = false;
    async function refresh() {
      try {
        const response = await fetch(`/api/v1/mobile/automations?jobIds=${encodeURIComponent(ids)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('No se ha podido actualizar el estado de los móviles.');
        const data = await response.json();
        if (!disposed) { setPollError(null); setPlan(p => p ? { ...p, entries: p.entries.map(e => ({ ...e, job: data.jobs.find((j: {id:string}) => j.id === e.job?.id) ?? e.job })) } : p); }
      } catch (e) { if (!disposed) setPollError(e instanceof Error ? e.message : 'Error al actualizar'); }
    }
    void refresh(); const timer = window.setInterval(refresh, 10000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [ids]);
  async function dispatch(next: FleetPlan) {
    if (lock.current || !canManage) return;
    lock.current = true; setBusy(true); setPlan(next);
    try {
      const result = await dispatchFleetPlan(next, async body => {
        const response = await fetch('/api/v1/mobile/automations/drafts', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message ?? data?.message ?? 'No se pudo crear el encargo');
        return data.job;
      }, setPlan);
      setPlan(result);
      onOpen(result.entries.filter(e => e.job).map(e => e.deviceSerial));
    } finally { lock.current = false; setBusy(false); }
  }
  return <section aria-label="Panel común de móviles" className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-bold text-slate-900">Automatización en varios móviles</h2>
    <p className="mt-1 text-sm text-slate-600">Configura un solo encargo para todos los móviles conectados o selecciona los que quieras. Cada móvil utilizará su propia cuenta.</p>
    {!canManage && <p className="mt-2 text-sm text-amber-800">Necesitas permisos de gestión para crear encargos.</p>}
    <fieldset disabled={busy || !!plan || !canManage} className="my-4 space-y-2">
      <legend className="text-sm font-semibold">Móviles destinatarios · {selected.length} de {devices.length}</legend>
      <div className="flex gap-3 text-sm"><button type="button" onClick={() => setExcluded([])}>Seleccionar todos</button><button type="button" onClick={() => setExcluded(devices.map(d=>d.deviceSerial))}>Quitar selección</button></div>
      {!devices.length && <p className="text-sm text-slate-500">Conecta y autoriza los móviles para empezar.</p>}
      <div className="grid gap-2 md:grid-cols-2">{devices.map(d => <label key={d.deviceSerial} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
        <input type="checkbox" disabled={!d.phoneKey} checked={!!d.phoneKey && !excluded.includes(d.deviceSerial)} onChange={e => setExcluded(prev => e.target.checked ? prev.filter(s=>s!==d.deviceSerial) : [...prev,d.deviceSerial])} />
        <span><strong>{d.label}</strong><span className="block text-xs text-slate-500">{d.deviceSerial}{!d.phoneKey ? ' · Asocia un número para incluir este móvil' : ''}</span></span>
      </label>)}</div>
    </fieldset>
    {!plan ? <MobileAutomationPanel deviceSerial="" phoneKey="" ready={false} onExecuteJob={async () => { throw new Error('El panel común no ejecuta trabajos'); }} onPasteText={async () => {}} composer={{ allowed: canManage && selected.length > 0, submitLabel: `Crear encargo en ${selected.length} móviles`, create: async body => { await dispatch(createFleetPlan(selected as FleetTarget[], body)); } }} /> : <div className="space-y-3">
      <h3 className="font-semibold">Seguimiento del encargo común</h3>
      <p className="text-sm text-slate-600">{busy ? 'Creando los trabajos…' : 'Cada móvil conserva su cola y sus aprobaciones. Mantén esta página abierta para ejecutar.'}</p>
      {plan.entries.map(e => <div key={e.deviceSerial} className="rounded-lg border p-3 text-sm"><div className="flex justify-between gap-3"><strong>{e.label}</strong><span>{e.job ? labels[e.job.status] ?? e.job.status : e.error ? 'No creado' : 'Pendiente de crear'}</span></div>{(e.error || e.job?.lastError) && <p className="mt-1 text-rose-700">{e.error || e.job?.lastError}</p>}<a className="mt-2 inline-block text-indigo-700 underline" href={`#mobile-device-${encodeURIComponent(e.deviceSerial)}`}>Ver móvil y revisar su cola</a></div>)}
      {pollError && <p role="alert" className="text-sm text-rose-700">{pollError}</p>}
      <div className="flex flex-wrap gap-3 text-sm">
        {plan.entries.some(e=>!e.job) && <button disabled={busy || !canManage} onClick={()=>void dispatch(plan)} className="rounded-lg bg-indigo-700 px-3 py-2 text-white disabled:opacity-50">Reintentar solo los no creados</button>}
        <button disabled={busy || !canManage} onClick={()=>onOpen(plan.entries.filter(e=>e.job).map(e=>e.deviceSerial))} className="rounded-lg border px-3 py-2">Abrir pantallas de este encargo</button>
        <button disabled={busy} onClick={()=>{setPlan(null);setPollError(null);}} className="rounded-lg border px-3 py-2">Nuevo encargo</button>
      </div><p className="text-xs text-slate-500">Nuevo encargo no cancela los trabajos anteriores. Puedes consultarlos en la cola de cada móvil.</p>
    </div>}
  </section>;
}
