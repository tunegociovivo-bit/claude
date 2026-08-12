"use client";

import { useEffect, useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import { Ban, Bot, Building2, CheckCircle2, LogOut, MessageCircle, Phone, Plus, RefreshCw, Wallet } from "lucide-react";

type Client = {
  id: string; name: string; slug: string; email: string; isBlocked: boolean; adminNotes: string;
  callsTotal: number; callsToday: number; whatsappTotal: number; whatsappToday: number;
  minutesTotal: number; minutesToday: number;
  callCost: number; whatsappCost: number; totalCost: number;
  callCostToday: number; whatsappCostToday: number; totalCostToday: number;
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
  const [names, setNames] = useState<Record<string, string>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [newClient, setNewClient] = useState({ name: "", contactName: "", email: "", password: "" });

  async function load() {
    const response = await fetch("/api/v1/admin/overview", { cache: "no-store" });
    if (!response.ok) return;
    const next = await response.json();
    setData(next); setPrompt(next.globalPrompt ?? "");
    setNotes(Object.fromEntries(next.clients.map((client: Client) => [client.id, client.adminNotes ?? ""])));
    setNames(Object.fromEntries(next.clients.map((client: Client) => [client.id, client.name])));
  }
  useEffect(() => { void load(); }, []);
  const totals = useMemo(() => (data?.clients ?? []).reduce((acc, client) => ({
    calls: acc.calls + client.callsTotal,
    whatsapp: acc.whatsapp + client.whatsappTotal,
    cost: acc.cost + client.totalCostToday,
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

  async function saveName(client: Client) {
    const name = (names[client.id] ?? "").trim();
    if (!name) { setNotice("El nombre del cliente no puede estar vacío."); return; }
    setBusy(`name:${client.id}`); setNotice("");
    const response = await fetch(`/api/v1/admin/clients/${client.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    });
    setBusy(null);
    setNotice(response.ok ? "Nombre del cliente actualizado." : "No se pudo cambiar el nombre.");
    if (response.ok) await load();
  }

  async function createClient(event: React.FormEvent) {
    event.preventDefault(); setBusy("create"); setNotice("");
    const response = await fetch("/api/v1/admin/clients", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newClient),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) { setNotice(result.error || "No se pudo crear el cliente."); return; }
    setNotice(`CRM de ${newClient.name} creado. Ya puede acceder con ${newClient.email}.`);
    setNewClient({ name: "", contactName: "", email: "", password: "" }); setShowCreate(false);
    await load();
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
          {[[Phone, "Llamadas acumuladas", totals.calls], [MessageCircle, "WhatsApp acumulados", totals.whatsapp], [Wallet, "Coste estimado hoy", money(totals.cost)]].map(([Icon, label, value]: any) => (
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
          <div className="mb-3 flex flex-wrap items-center gap-2"><Building2 size={19} /><h2 className="font-semibold">Clientes ({data?.clients.length ?? 0})</h2><button className="btn-primary ml-auto" onClick={() => setShowCreate((value) => !value)}><Plus className="mr-1 inline" size={16} />{showCreate ? "Cancelar" : "Añadir cliente"}</button></div>
          {showCreate && <form onSubmit={createClient} className="card mb-4 grid gap-4 p-5 sm:grid-cols-2">
            <div className="sm:col-span-2"><h3 className="font-semibold">Crear nuevo CRM de ventas</h3><p className="text-sm text-slate-500">Se creará un espacio independiente y un usuario administrador para el cliente.</p></div>
            <label className="text-sm font-medium text-slate-700">Nombre principal del cliente<input className="input mt-1" required maxLength={120} value={newClient.name} onChange={(event) => setNewClient((current) => ({ ...current, name: event.target.value }))} placeholder="Empresa o nombre comercial" /></label>
            <label className="text-sm font-medium text-slate-700">Persona de contacto<input className="input mt-1" maxLength={120} value={newClient.contactName} onChange={(event) => setNewClient((current) => ({ ...current, contactName: event.target.value }))} placeholder="Nombre del administrador" /></label>
            <label className="text-sm font-medium text-slate-700">Correo de acceso<input className="input mt-1" required type="email" autoComplete="off" value={newClient.email} onChange={(event) => setNewClient((current) => ({ ...current, email: event.target.value }))} placeholder="cliente@empresa.com" /></label>
            <label className="text-sm font-medium text-slate-700">Contraseña inicial<input className="input mt-1" required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={newClient.password} onChange={(event) => setNewClient((current) => ({ ...current, password: event.target.value }))} placeholder="Mínimo 8 caracteres" /></label>
            <div className="sm:col-span-2"><button className="btn-primary" disabled={busy === "create"} type="submit">{busy === "create" ? "Creando CRM…" : "Crear cliente y CRM"}</button></div>
          </form>}
          <div className="grid gap-4 lg:grid-cols-2">
            {(data?.clients ?? []).map((client) => (
              <article key={client.id} className={`card p-5 ${client.isBlocked ? "border-red-200 bg-red-50/40" : ""}`}>
                <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-col gap-2 sm:flex-row sm:items-center"><input aria-label={`Nombre de ${client.name}`} className="input min-w-0 flex-1 font-semibold" maxLength={120} value={names[client.id] ?? ""} onChange={(event) => setNames((current) => ({ ...current, [client.id]: event.target.value }))} /><button className="btn-ghost shrink-0" disabled={busy === `name:${client.id}`} onClick={() => saveName(client)}>{busy === `name:${client.id}` ? "Guardando…" : "Guardar nombre"}</button>{client.isBlocked ? <span className="w-fit rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Bloqueado</span> : <span className="w-fit rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Activo</span>}</div><p className="mt-1 truncate text-sm text-slate-500">{client.email}</p></div><button disabled={busy === client.id} onClick={() => toggle(client)} className={`rounded-lg px-3 py-2 text-sm font-medium ${client.isBlocked ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>{client.isBlocked ? <><CheckCircle2 className="mr-1 inline" size={15} />Activar</> : <><Ban className="mr-1 inline" size={15} />Bloquear</>}</button></div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Llamadas totales", client.callsTotal], ["Minutos totales", client.minutesTotal], ["WhatsApp totales", client.whatsappTotal], ["Coste hoy", money(client.totalCostToday)]].map(([label, value]) => <div key={label} className="rounded-xl bg-white p-3 ring-1 ring-slate-100"><p className="text-xs text-slate-500">{label}</p><p className="font-semibold">{value}</p></div>)}</div>
                <p className="mt-3 text-xs text-slate-400">Voz {money(client.callCost)} · WhatsApp {money(client.whatsappCost)}</p>
                <p className="mt-2 text-xs text-slate-400">Hoy: {client.callsToday} llamadas, {client.minutesToday} min, {client.whatsappToday} WhatsApp y {money(client.totalCostToday)} de coste.</p>
                <p className="mt-1 text-xs text-slate-400">Coste acumulado estimado: {money(client.totalCost)}</p>
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
