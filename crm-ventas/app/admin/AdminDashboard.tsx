"use client";

import { useEffect, useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import { Ban, Bot, Building2, CheckCircle2, LogOut, MessageCircle, Phone, RefreshCw, Wallet } from "lucide-react";

type Client = {
  id: string; name: string; slug: string; email: string; isBlocked: boolean; adminNotes: string;
  callsToday: number; whatsappToday: number; minutesToday: number;
  callCost: number; whatsappCost: number; totalCost: number;
};
type Overview = {
  globalPrompt: string;
  currency: string;
  rates: { callMinuteRate: number; whatsappMessageRate: number };
  clients: Client[];
};

export default function AdminDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function load() {
    const response = await fetch("/api/v1/admin/overview", { cache: "no-store" });
    if (!response.ok) return;
    const next = await response.json();
    setData(next); setPrompt(next.globalPrompt ?? "");
    setNotes(Object.fromEntries(next.clients.map((client: Client) => [client.id, client.adminNotes ?? ""])));
  }
  useEffect(() => { void load(); }, []);
  const totals = useMemo(() => (data?.clients ?? []).reduce((acc, client) => ({
    calls: acc.calls + client.callsToday,
    whatsapp: acc.whatsapp + client.whatsappToday,
    cost: acc.cost + client.totalCost,
  }), { calls: 0, whatsapp: 0, cost: 0 }), [data]);
  const money = (value: number) => new Intl.NumberFormat("es-ES", {
    style: "currency", currency: data?.currency || "USD", minimumFractionDigits: 3,
  }).format(value);

  async function savePrompt() {
    setBusy("prompt"); setNotice("");
    const response = await fetch("/api/v1/admin/overview", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ globalPrompt: prompt }),
    });
    setBusy(null); setNotice(response.ok ? "Prompt general guardado y activo para todos los clientes." : "No se pudo guardar.");
  }

  async function toggle(client: Client) {
    const action = client.isBlocked ? "desbloquear" : "bloquear";
    if (!window.confirm(`¿Seguro que quieres ${action} a ${client.name}?`)) return;
    setBusy(client.id);
    const response = await fetch(`/api/v1/admin/clients/${client.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isBlocked: !client.isBlocked }),
    });
    setBusy(null);
    if (response.ok) await load();
  }

  async function saveNotes(client: Client) {
    setBusy(`notes:${client.id}`); setNotice("");
    const response = await fetch(`/api/v1/admin/clients/${client.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adminNotes: notes[client.id] ?? "" }),
    });
    setBusy(null);
    setNotice(response.ok ? `Notas de ${client.name} guardadas.` : "No se pudieron guardar las notas.");
    if (response.ok) await load();
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:px-6">
          <img src="https://www.negociovivo.com/wp-content/uploads/2020/08/negociovivo.png" alt="Negocio Vivo" className="h-10 w-10 rounded-xl object-contain" />
          <div><h1 className="font-semibold text-slate-900">Administración general</h1><p className="text-xs text-slate-500">CRM Ventas · Negocio Vivo</p></div>
          <button onClick={() => void load()} className="ml-auto rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Actualizar"><RefreshCw size={18} /></button>
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Salir"><LogOut size={18} /></button>
        </div>
      </header>
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <section className="grid gap-3 sm:grid-cols-3">
          {[[Phone, "Llamadas hoy", totals.calls], [MessageCircle, "Mensajes WhatsApp hoy", totals.whatsapp], [Wallet, "Coste estimado hoy", money(totals.cost)]].map(([Icon, label, value]: any) => (
            <div key={label} className="card flex items-center gap-4 p-4"><div className="rounded-xl bg-brand-50 p-3 text-brand-600"><Icon size={21} /></div><div><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-semibold">{value}</p></div></div>
          ))}
        </section>
        {data && <p className="-mt-3 text-xs text-slate-500">Estimación configurada: {money(data.rates.callMinuteRate)} por minuto de voz cuando Vapi no informa del coste real y {money(data.rates.whatsappMessageRate)} por mensaje entrante.</p>}

        <section className="card p-5">
          <div className="mb-3 flex items-center gap-2"><Bot size={19} className="text-brand-600" /><div><h2 className="font-semibold">Prompt general</h2><p className="text-sm text-slate-500">Se añade a las instrucciones de llamadas y WhatsApp de todos los clientes.</p></div></div>
          <textarea className="input min-h-40 resize-y" value={prompt} maxLength={12000} onChange={(event) => setPrompt(event.target.value)} placeholder="Normas comunes obligatorias para todos los agentes…" />
          <div className="mt-3 flex flex-wrap items-center gap-3"><button className="btn-primary" disabled={busy === "prompt"} onClick={savePrompt}>{busy === "prompt" ? "Guardando…" : "Guardar y aplicar"}</button><span className="text-xs text-slate-400">{prompt.length}/12.000</span>{notice && <span className="text-sm text-emerald-700">{notice}</span>}</div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2"><Building2 size={19} /><h2 className="font-semibold">Clientes ({data?.clients.length ?? 0})</h2></div>
          <div className="grid gap-4 lg:grid-cols-2">
            {(data?.clients ?? []).map((client) => (
              <article key={client.id} className={`card p-5 ${client.isBlocked ? "border-red-200 bg-red-50/40" : ""}`}>
                <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate font-semibold">{client.name}</h3>{client.isBlocked ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Bloqueado</span> : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Activo</span>}</div><p className="truncate text-sm text-slate-500">{client.email}</p></div><button disabled={busy === client.id} onClick={() => toggle(client)} className={`rounded-lg px-3 py-2 text-sm font-medium ${client.isBlocked ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>{client.isBlocked ? <><CheckCircle2 className="mr-1 inline" size={15} />Activar</> : <><Ban className="mr-1 inline" size={15} />Bloquear</>}</button></div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Llamadas", client.callsToday], ["Minutos", client.minutesToday], ["WhatsApp", client.whatsappToday], ["Coste", money(client.totalCost)]].map(([label, value]) => <div key={label} className="rounded-xl bg-white p-3 ring-1 ring-slate-100"><p className="text-xs text-slate-500">{label}</p><p className="font-semibold">{value}</p></div>)}</div>
                <p className="mt-3 text-xs text-slate-400">Voz {money(client.callCost)} · WhatsApp {money(client.whatsappCost)}</p>
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor={`notes-${client.id}`}>Notas internas</label>
                  <textarea id={`notes-${client.id}`} className="input min-h-24 resize-y" maxLength={4000} value={notes[client.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [client.id]: event.target.value }))} placeholder="Información comercial, incidencias, condiciones acordadas…" />
                  <div className="mt-2 flex items-center justify-between gap-3"><span className="text-xs text-slate-400">{(notes[client.id] ?? "").length}/4.000</span><button className="btn-primary" disabled={busy === `notes:${client.id}`} onClick={() => saveNotes(client)}>{busy === `notes:${client.id}` ? "Guardando…" : "Guardar notas"}</button></div>
                </div>
              </article>
            ))}
          </div>
          {!data && <p className="py-10 text-center text-slate-500">Cargando clientes…</p>}
        </section>
      </div>
    </main>
  );
}
