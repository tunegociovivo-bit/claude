"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, RefreshCw } from "lucide-react";
import type { MobileFacebookAccount, MobileFacebookAccountRequest } from "@/lib/mobile/facebook-accounts";

type AccountForm = { id: string; version: number; name: string; username: string; password: string; savedOnDevice: boolean; hasPassword: boolean };

async function accountRequest(body: MobileFacebookAccountRequest): Promise<MobileFacebookAccount[]> {
  const response = await fetch("/api/v1/mobile/devices/facebook-accounts", {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data?.accounts)) throw new Error(data?.error?.message ?? data?.message ?? "No se pudieron cargar las cuentas de este teléfono.");
  return data.accounts;
}

export default function MobileFacebookAccountsPanel({ deviceSerial }: { deviceSerial: string }) {
  const [accounts, setAccounts] = useState<MobileFacebookAccount[]>([]);
  const [form, setForm] = useState<AccountForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const pendingMutation = useRef<{ signature: string; id: string } | null>(null);
  const requestLock = useRef(false);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true); setError(null);
    try { const items = await accountRequest({ action: "list", deviceSerial }); if (generation === loadGeneration.current) setAccounts(items); }
    catch (e) { if (generation === loadGeneration.current) setError(e instanceof Error ? e.message : "No se pudieron cargar las cuentas."); }
    finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [deviceSerial]);
  useEffect(() => { void load(); return () => { loadGeneration.current++; }; }, [load]);

  function mutationId(body: object) {
    const signature = JSON.stringify(body);
    if (pendingMutation.current?.signature !== signature) pendingMutation.current = { signature, id: crypto.randomUUID() };
    return pendingMutation.current.id;
  }

  function edit(account?: MobileFacebookAccount) {
    setFeedback(null); setError(null); pendingMutation.current = null;
    setForm(account ? { ...account, password: "" } : { id: crypto.randomUUID(), version: 0, name: "", username: "", password: "", savedOnDevice: false, hasPassword: false });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || requestLock.current) return;
    requestLock.current = true; setBusy(true); setError(null); setFeedback(null);
    const body = { action: "save" as const, deviceSerial, id: form.id, version: form.version, name: form.name.trim(), username: form.username.trim(), savedOnDevice: form.savedOnDevice, ...(form.password ? { password: form.password } : {}) };
    try {
      const items = await accountRequest({ ...body, mutationId: mutationId(body) });
      ++loadGeneration.current; setLoading(false); setAccounts(items); setForm(null); pendingMutation.current = null;
      setFeedback("Cuenta guardada y asociada a este teléfono.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar la cuenta."); }
    finally { requestLock.current = false; setBusy(false); }
  }

  async function setActive(account: MobileFacebookAccount) {
    if (requestLock.current) return;
    requestLock.current = true; setBusy(true); setError(null); setFeedback(null);
    const body = { action: "setActive" as const, deviceSerial, id: account.id, version: account.version, active: !account.active };
    try {
      const items = await accountRequest({ ...body, mutationId: mutationId(body) });
      ++loadGeneration.current; setLoading(false); setAccounts(items); pendingMutation.current = null;
      setFeedback(account.active ? "Cuenta desactivada. Puedes volver a activarla cuando quieras." : "Cuenta activada.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo modificar la cuenta."); }
    finally { requestLock.current = false; setBusy(false); }
  }

  const active = accounts.filter(account => account.active);
  return <section aria-label="Cuentas de Facebook del teléfono" className="rounded-xl border border-blue-200 bg-blue-50/40 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-bold text-slate-900">Cuentas de Facebook · {active.length}</h3>
      <div className="flex gap-2">
        <button type="button" aria-label="Actualizar cuentas de Facebook" onClick={() => void load()} disabled={loading || busy} className="rounded-lg border bg-white p-2 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
        <button type="button" onClick={() => edit()} disabled={loading || busy || !!form || accounts.length >= 20} className="inline-flex items-center gap-1 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" /> Añadir cuenta</button>
      </div>
    </div>
    <p className="mt-2 text-xs leading-5 text-slate-600">Guarda aquí las cuentas que utilizarás en este móvil. El usuario y la contraseña se guardan cifrados. Añadir una cuenta al Hub no inicia sesión en Facebook.</p>
    {form && <form onSubmit={save} className="mt-3 space-y-3 rounded-lg border bg-white p-3">
      <h4 className="text-sm font-semibold">{form.version ? "Editar cuenta" : "Añadir cuenta de Facebook"}</h4>
      <fieldset disabled={busy || loading} className="space-y-3">
        <label className="block text-xs font-semibold">Nombre que aparece en Facebook
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required maxLength={120} autoComplete="off" placeholder="Nombre del perfil" className="mt-1 w-full rounded-lg border p-2 text-sm font-normal" />
        </label>
        <label className="block text-xs font-semibold">Usuario, correo o teléfono
          <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} required maxLength={254} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Datos de acceso a Facebook" className="mt-1 w-full rounded-lg border p-2 text-sm font-normal" />
        </label>
        <label className="block text-xs font-semibold">Contraseña de Facebook
          <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required={!form.hasPassword && !form.savedOnDevice} maxLength={1024} autoComplete="new-password" placeholder={form.hasPassword ? "Deja vacío para conservar la contraseña guardada" : "Contraseña de esta cuenta"} className="mt-1 w-full rounded-lg border p-2 text-sm font-normal" />
          {form.hasPassword && <span className="mt-1 block font-normal text-slate-500">Hay una contraseña guardada. Solo escribe aquí si quieres sustituirla.</span>}
        </label>
        <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={form.savedOnDevice} onChange={e => setForm({ ...form, savedOnDevice: e.target.checked })} className="mt-1" />Ya he guardado esta cuenta en la app de Facebook de este móvil.</label>
        <p className="text-xs text-slate-500">Si Facebook pide un código de verificación, deberás completarlo en el teléfono. No se comprueba el acceso al guardar este formulario.</p>
        <div className="flex gap-2"><button type="submit" className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white">{busy ? "Guardando…" : "Guardar cuenta"}</button><button type="button" onClick={() => { setForm(null); pendingMutation.current = null; }} className="rounded-lg border px-3 py-2 text-xs">Cancelar</button></div>
      </fieldset>
    </form>}
    {loading ? <p className="mt-3 text-xs text-slate-500">Cargando cuentas…</p> : !accounts.length && !error ? <p className="mt-3 text-xs text-slate-600">Todavía no hay cuentas guardadas para este teléfono.</p> : <div className="mt-3 space-y-2">
      {accounts.filter(account => account.active || showInactive).map(account => <div key={account.id} className="rounded-lg border bg-white p-3 text-xs">
        <div className="flex flex-wrap justify-between gap-2"><strong className="break-words">{account.name}</strong><span>{account.active ? "Activa" : "Desactivada"}</span></div>
        <p className="mt-1 break-all text-slate-600">{account.username}</p>
        <p className="mt-1 text-slate-500">{account.hasPassword ? "Contraseña guardada" : "Sin contraseña en el Hub"} · {account.savedOnDevice ? "Indicada como guardada en Facebook" : "Pendiente de guardar en Facebook"}</p>
        <div className="mt-2 flex gap-3"><button type="button" disabled={busy || !!form} onClick={() => edit(account)} className="font-semibold text-blue-700 disabled:opacity-50">Editar</button><button type="button" disabled={busy || !!form} onClick={() => void setActive(account)} className="text-slate-600 disabled:opacity-50">{account.active ? "Desactivar" : "Reactivar"}</button></div>
      </div>)}
      {accounts.some(account => !account.active) && <button type="button" onClick={() => setShowInactive(value => !value)} className="text-xs text-blue-700">{showInactive ? "Ocultar desactivadas" : "Mostrar cuentas desactivadas"}</button>}
    </div>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-2 text-xs text-rose-800">{error}</p>}
    {feedback && <p role="status" className="mt-3 text-xs text-blue-800">{feedback}</p>}
  </section>;
}
