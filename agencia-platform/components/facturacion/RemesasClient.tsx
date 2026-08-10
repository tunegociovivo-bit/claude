"use client";

import { Fragment, useEffect, useState } from "react";

type Req = {
  id: string; status: string; companyName: string; clientName: string; invoiceNumber: string | null;
  amountCents: number; currency: string; mandateRef: string | null; ibanMasked: string | null;
  providerStatus: string; approvedAt: string | null; rejectedAt: string | null; rejectReason: string | null;
  chargeDate: string | null; createdAt: string; tokenExpiresAt: string;
};
type SepaClient = {
  id: string; name: string; sepaEnabled: boolean; sepaMandateRef: string | null;
  sepaMandateActive: boolean; sepaSantanderTemplate: string | null; sepaIbanMasked: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: "Pendiente de aprobación", APPROVED: "Aprobada", PREPARING: "Preparando",
  PENDING_SIGNATURE: "Pendiente de firma", SIGNED: "Firmada", REJECTED: "Rechazada", EXPIRED: "Caducada", FAILED: "Fallida"
};
const STATUS_CLASS: Record<string, string> = {
  PENDING_APPROVAL: "bg-amber-100 text-amber-800 border-amber-300",
  APPROVED: "bg-emerald-100 text-emerald-800 border-emerald-300",
  PREPARING: "bg-sky-100 text-sky-800 border-sky-300",
  PENDING_SIGNATURE: "bg-indigo-100 text-indigo-800 border-indigo-300",
  SIGNED: "bg-emerald-100 text-emerald-800 border-emerald-400",
  REJECTED: "bg-rose-100 text-rose-800 border-rose-300",
  EXPIRED: "bg-slate-100 text-slate-600 border-slate-300",
  FAILED: "bg-rose-100 text-rose-800 border-rose-400"
};

function euros(cents: number, cur: string) {
  return `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}

export default function RemesasClient({ providerStatus, issuerMissing }: { providerStatus: string; issuerMissing: boolean }) {
  const [tab, setTab] = useState<"requests" | "clients" | "agent">("requests");
  return (
    <div className="space-y-4">
      {issuerMissing && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          No existe la empresa emisora <strong>Negocio Vivo S.C.A.</strong> en este workspace. Créala en Emisores para poder generar remesas.
        </div>
      )}
      {providerStatus !== "CONFIGURED" && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          <strong>Santander funciona mediante el agente local.</strong> Al aprobar, el agente prepara la remesa en el navegador y la deja pendiente de firma. Nunca firma ni ejecuta el cobro por ti.
        </div>
      )}
      <div className="inline-flex rounded-lg border bg-white overflow-hidden text-sm">
        <button onClick={() => setTab("requests")} className={"px-3 py-1.5 " + (tab === "requests" ? "bg-brand-600 text-white font-semibold" : "text-slate-600 hover:bg-slate-50")}>Solicitudes</button>
        <button onClick={() => setTab("clients")} className={"px-3 py-1.5 border-l " + (tab === "clients" ? "bg-brand-600 text-white font-semibold" : "text-slate-600 hover:bg-slate-50")}>Clientes SEPA</button>
        <button onClick={() => setTab("agent")} className={"px-3 py-1.5 border-l " + (tab === "agent" ? "bg-brand-600 text-white font-semibold" : "text-slate-600 hover:bg-slate-50")}>Agente bancario</button>
      </div>
      {tab === "requests" ? <RequestsTab /> : tab === "clients" ? <ClientsTab /> : <AgentTab />}
    </div>
  );
}

function RequestsTab() {
  const [items, setItems] = useState<Req[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/v1/facturacion/remesas?${status ? `status=${status}&` : ""}pageSize=100`);
      if (r.ok) { const j = await r.json(); setItems(j.items ?? []); setTotal(j.total ?? 0); }
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [status]);

  async function scan() {
    if (!confirm("Buscar facturas candidatas de Negocio Vivo y crear sus solicitudes (se enviará un email de aprobación por cada nueva). ¿Continuar?")) return;
    setScanning(true); setMsg(null);
    try {
      const r = await fetch("/api/v1/facturacion/remesas/scan", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j?.error?.message ?? j?.message ?? "Error al buscar candidatas"); return; }
      setMsg(`Examinadas ${j.examined} facturas emitidas hoy · ${j.eligible} elegibles · ${j.created} solicitudes creadas · ${j.skipped} ya existían/omitidas${j.invalidated ? ` · ${j.invalidated} históricas invalidadas` : ""}.`);
      await load();
    } finally { setScanning(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-2 py-1.5 rounded border text-sm bg-white">
          <option value="">Todos los estados</option>
          {Object.keys(STATUS_LABEL).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <button onClick={() => void scan()} disabled={scanning} className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">
          {scanning ? "Buscando…" : "Buscar candidatas"}
        </button>
        <span className="text-xs text-slate-500">{total} solicitud(es)</span>
      </div>
      {msg && <div className="text-xs text-slate-700 bg-slate-50 border rounded px-2 py-1.5">{msg}</div>}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Factura</th><th className="px-3 py-2">Importe</th><th className="px-3 py-2">Mandato / IBAN</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Creada</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Cargando…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Sin solicitudes. Pulsa "Buscar candidatas".</td></tr>
            ) : items.map((it) => (
              <tr key={it.id} className="border-t">
                <td className="px-3 py-2 font-medium">{it.clientName}</td>
                <td className="px-3 py-2">{it.invoiceNumber ?? "—"}</td>
                <td className="px-3 py-2">{euros(it.amountCents, it.currency)}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{it.mandateRef ?? "—"}{it.ibanMasked ? ` · ${it.ibanMasked}` : ""}</td>
                <td className="px-3 py-2"><span className={"inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold " + (STATUS_CLASS[it.status] ?? "bg-slate-100")}>{STATUS_LABEL[it.status] ?? it.status}</span>{it.status === "REJECTED" && it.rejectReason ? <div className="text-[10px] text-rose-600 mt-0.5">{it.rejectReason}</div> : null}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{new Date(it.createdAt).toLocaleDateString("es-ES")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">El enlace de aprobación llega por email a info@negociovivo.com (un solo uso, caduca en 24 h, requiere iniciar sesión). Aprobar no ejecuta el cobro.</p>
    </div>
  );
}

function ClientsTab() {
  const [items, setItems] = useState<SepaClient[]>([]);
  const [q, setQ] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    const r = await fetch(`/api/v1/facturacion/clients-sepa?${q ? `q=${encodeURIComponent(q)}` : ""}`);
    if (r.ok) setItems((await r.json()).items ?? []);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  async function save(c: SepaClient, iban: string) {
    setSavingId(c.id);
    try {
      const body: any = {
        sepaEnabled: c.sepaEnabled, sepaMandateRef: c.sepaMandateRef, sepaMandateActive: c.sepaMandateActive,
        sepaSantanderTemplate: c.sepaSantanderTemplate
      };
      if (iban.trim()) body.iban = iban.trim();
      const r = await fetch(`/api/v1/facturacion/clients-sepa/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j?.error?.message ?? "No se pudo guardar"); return; }
      setItems((prev) => prev.map((x) => (x.id === c.id ? j.client : x)));
    } finally { setSavingId(null); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="Buscar cliente…" className="px-2 py-1.5 rounded border text-sm bg-white" />
        <button onClick={() => void load()} className="px-3 py-1.5 rounded-lg border bg-white text-sm hover:bg-slate-50">Buscar</button>
        <span className="text-[11px] text-amber-700">El cobro SEPA es opt-in: desactivado por defecto. Nunca se guarda el IBAN completo.</span>
      </div>
      <div className="space-y-2">
        {items.map((c) => (
          <SepaClientRow key={c.id} client={c} saving={savingId === c.id} onChange={(x) => setItems((prev) => prev.map((p) => (p.id === c.id ? x : p)))} onSave={save} />
        ))}
        {items.length === 0 && <div className="text-sm text-slate-400 px-1 py-4">Sin clientes.</div>}
      </div>
    </div>
  );
}

function SepaClientRow({ client, saving, onChange, onSave }: { client: SepaClient; saving: boolean; onChange: (c: SepaClient) => void; onSave: (c: SepaClient, iban: string) => void }) {
  const [iban, setIban] = useState("");
  return (
    <div className={"rounded-lg border p-3 " + (client.sepaEnabled ? "border-emerald-200 bg-emerald-50/40" : "bg-white")}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-medium text-slate-800">{client.name}</div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={client.sepaEnabled} onChange={(e) => onChange({ ...client, sepaEnabled: e.target.checked })} className="accent-emerald-600" />
          Habilitado para cobro SEPA
        </label>
      </div>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input value={client.sepaMandateRef ?? ""} onChange={(e) => onChange({ ...client, sepaMandateRef: e.target.value })} placeholder="Referencia de mandato SEPA" className="px-2 py-1.5 rounded border text-sm" />
        <input value={client.sepaSantanderTemplate ?? ""} onChange={(e) => onChange({ ...client, sepaSantanderTemplate: e.target.value })} placeholder="Plantilla/ref. recurrente Santander" className="px-2 py-1.5 rounded border text-sm" />
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={client.sepaMandateActive} onChange={(e) => onChange({ ...client, sepaMandateActive: e.target.checked })} className="accent-emerald-600" />
          Mandato activo
        </label>
        <input value={iban} onChange={(e) => setIban(e.target.value)} placeholder={client.sepaIbanMasked ? `IBAN guardado: ${client.sepaIbanMasked}` : "IBAN (se guarda enmascarado)"} className="px-2 py-1.5 rounded border text-sm" />
      </div>
      <div className="mt-2">
        <button onClick={() => onSave(client, iban)} disabled={saving} className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-50">{saving ? "Guardando…" : "Guardar"}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agente bancario (fase 2): kill switch, agentes enrolados y cola de trabajos.
// ---------------------------------------------------------------------------
type Agent = {
  id: string; name: string; status: string; version: string | null; platform: string | null;
  lastHeartbeatAt: string | null; createdAt: string; revokedAt: string | null; online: boolean;
};
type Job = {
  id: string; status: string; invoiceNumber: string | null; clientName: string;
  amountCents: number; currency: string; ibanMasked: string | null; attempts: number;
  lastProgress: string | null; needsUserReason: string | null; lastError: string | null;
  resultRef: string | null; chargeDate: string | null; createdAt: string; updatedAt: string;
};
type JobEvent = { fromStatus: string | null; toStatus: string; note: string | null; createdAt: string; agentId: string | null };

const JOB_STATUS_LABEL: Record<string, string> = {
  PENDING: "En cola", CLAIMED: "Reclamado", RUNNING: "En ejecución", NEEDS_USER: "Requiere intervención",
  PREPARED_PENDING_SIGNATURE: "Preparado · pendiente de firma", FAILED: "Fallido", CANCELLED: "Cancelado"
};
const JOB_STATUS_CLASS: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-600 border-slate-300",
  CLAIMED: "bg-sky-100 text-sky-800 border-sky-300",
  RUNNING: "bg-sky-100 text-sky-800 border-sky-400",
  NEEDS_USER: "bg-amber-100 text-amber-800 border-amber-300",
  PREPARED_PENDING_SIGNATURE: "bg-indigo-100 text-indigo-800 border-indigo-300",
  FAILED: "bg-rose-100 text-rose-800 border-rose-400",
  CANCELLED: "bg-slate-100 text-slate-500 border-slate-300"
};

// Lee el token CSRF-safe: las rutas admin exigen mismo origen; fetch same-origin ya lo cumple.
async function postJson(url: string, body?: any) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j };
}

function AgentTab() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [savingSwitch, setSavingSwitch] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [newName, setNewName] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [openLog, setOpenLog] = useState<string | null>(null);
  const [logItems, setLogItems] = useState<JobEvent[]>([]);
  const [busyJob, setBusyJob] = useState<string | null>(null);

  async function loadAll() {
    const [ks, ag, jb] = await Promise.all([
      fetch("/api/v1/facturacion/agents/killswitch"),
      fetch("/api/v1/facturacion/agents"),
      fetch("/api/v1/facturacion/jobs?pageSize=100")
    ]);
    if (ks.ok) setEnabled((await ks.json()).enabled === true);
    if (ag.ok) setAgents((await ag.json()).items ?? []);
    if (jb.ok) setJobs((await jb.json()).items ?? []);
  }
  useEffect(() => { void loadAll(); /* eslint-disable-next-line */ }, []);
  // Refresco periódico ligero para ver online/offline y avances.
  useEffect(() => {
    const t = setInterval(() => { void loadAll(); }, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, []);

  async function toggleSwitch(next: boolean) {
    if (next && !confirm("Habilitar que el agente reclame trabajos. El agente preparará remesas en Santander y las dejará PENDIENTES DE FIRMA (nunca firma ni cobra). ¿Continuar?")) return;
    setSavingSwitch(true);
    try {
      const { ok, j } = await fetch("/api/v1/facturacion/agents/killswitch", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }) }).then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) }));
      if (ok) setEnabled(j.enabled === true); else alert(j?.error?.message ?? "No se pudo cambiar");
    } finally { setSavingSwitch(false); }
  }

  async function enroll() {
    if (!newName.trim()) return;
    setEnrolling(true); setNewToken(null);
    try {
      const { ok, j } = await postJson("/api/v1/facturacion/agents", { name: newName.trim() });
      if (!ok) { alert(j?.error?.message ?? "No se pudo enrolar"); return; }
      setNewToken(j.token); setNewName("");
      await loadAll();
    } finally { setEnrolling(false); }
  }

  async function revoke(id: string) {
    if (!confirm("Revocar este agente. Su token dejará de funcionar de inmediato. ¿Continuar?")) return;
    const { ok, j } = await postJson(`/api/v1/facturacion/agents/${id}/revoke`);
    if (!ok) { alert(j?.error?.message ?? "No se pudo revocar"); return; }
    await loadAll();
  }

  async function jobAction(id: string, action: "retry" | "cancel") {
    if (action === "cancel" && !confirm("Cancelar este trabajo bancario. ¿Continuar?")) return;
    setBusyJob(id);
    try {
      const { ok, j } = await postJson(`/api/v1/facturacion/jobs/${id}/${action}`);
      if (!ok) { alert(j?.error?.message ?? "No se pudo completar la acción"); return; }
      await loadAll();
    } finally { setBusyJob(null); }
  }

  async function toggleLog(id: string) {
    if (openLog === id) { setOpenLog(null); return; }
    setOpenLog(id); setLogItems([]);
    const r = await fetch(`/api/v1/facturacion/jobs/${id}/events`);
    if (r.ok) setLogItems((await r.json()).items ?? []);
  }

  return (
    <div className="space-y-5">
      {/* Kill switch */}
      <div className={"rounded-lg border p-3 " + (enabled ? "border-emerald-300 bg-emerald-50/50" : "border-slate-300 bg-white")}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-semibold text-slate-800">Interruptor del agente (kill switch)</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {enabled === null ? "Cargando…" : enabled
                ? "Habilitado: los agentes online pueden reclamar y preparar trabajos (nunca firman)."
                : "Pausado: ningún agente reclama trabajos. Estado seguro por defecto."}
            </div>
          </div>
          <button
            onClick={() => enabled !== null && void toggleSwitch(!enabled)}
            disabled={savingSwitch || enabled === null}
            className={"px-3 py-1.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 " + (enabled ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700")}
          >
            {savingSwitch ? "…" : enabled ? "Pausar agente" : "Habilitar agente"}
          </button>
        </div>
      </div>

      {/* Agentes */}
      <div className="rounded-lg border bg-white p-3 space-y-3">
        <div className="font-semibold text-slate-800">Agentes bancarios</div>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enroll()} placeholder="Nombre del agente (p. ej. PC-Oficina)" className="px-2 py-1.5 rounded border text-sm" />
          <button onClick={() => void enroll()} disabled={enrolling || !newName.trim()} className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50">{enrolling ? "Enrolando…" : "Enrolar agente"}</button>
        </div>
        {newToken && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            <div className="font-semibold text-amber-900">Token del agente (se muestra una sola vez)</div>
            <code className="block mt-1 break-all rounded bg-white border px-2 py-1 text-[12px] text-slate-800">{newToken}</code>
            <div className="mt-1 flex items-center gap-2">
              <button onClick={() => { void navigator.clipboard?.writeText(newToken); }} className="px-2 py-1 rounded border bg-white text-xs hover:bg-slate-50">Copiar</button>
              <button onClick={() => setNewToken(null)} className="px-2 py-1 rounded border bg-white text-xs hover:bg-slate-50">He guardado el token</button>
            </div>
            <div className="text-[11px] text-amber-700 mt-1">Guárdalo en el fichero de configuración del agente local. No se puede recuperar; si lo pierdes, revoca y enrola de nuevo.</div>
          </div>
        )}
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-3 py-2">Agente</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Versión / SO</th><th className="px-3 py-2">Último latido</th><th className="px-3 py-2"></th></tr>
            </thead>
            <tbody>
              {agents.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400">Ningún agente enrolado.</td></tr>
              ) : agents.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{a.name}</td>
                  <td className="px-3 py-2">
                    {a.status === "REVOKED" ? (
                      <span className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold bg-slate-100 text-slate-500 border-slate-300">Revocado</span>
                    ) : a.online ? (
                      <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold bg-emerald-100 text-emerald-800 border-emerald-300"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Online</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold bg-slate-100 text-slate-500 border-slate-300"><span className="w-1.5 h-1.5 rounded-full bg-slate-400" />Offline</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{a.version ?? "—"}{a.platform ? ` · ${a.platform}` : ""}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{a.lastHeartbeatAt ? new Date(a.lastHeartbeatAt).toLocaleString("es-ES") : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {a.status !== "REVOKED" && <button onClick={() => void revoke(a.id)} className="px-2 py-1 rounded border text-xs text-rose-700 hover:bg-rose-50">Revocar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Trabajos */}
      <div className="rounded-lg border bg-white p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-slate-800">Trabajos bancarios</div>
          <button onClick={() => void loadAll()} className="px-2 py-1 rounded border text-xs hover:bg-slate-50">Refrescar</button>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Factura</th><th className="px-3 py-2">Importe</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Intentos</th><th className="px-3 py-2"></th></tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400">Sin trabajos. Se crean al aprobar una solicitud.</td></tr>
              ) : jobs.map((j) => (
                <Fragment key={j.id}>
                  <tr className="border-t">
                    <td className="px-3 py-2 font-medium">{j.clientName}</td>
                    <td className="px-3 py-2">{j.invoiceNumber ?? "—"}</td>
                    <td className="px-3 py-2">{euros(j.amountCents, j.currency)}</td>
                    <td className="px-3 py-2">
                      <span className={"inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold " + (JOB_STATUS_CLASS[j.status] ?? "bg-slate-100")}>{JOB_STATUS_LABEL[j.status] ?? j.status}</span>
                      {j.status === "NEEDS_USER" && j.needsUserReason ? <div className="text-[10px] text-amber-700 mt-0.5">{j.needsUserReason}</div> : null}
                      {j.status === "FAILED" && j.lastError ? <div className="text-[10px] text-rose-600 mt-0.5">{j.lastError}</div> : null}
                      {j.status === "RUNNING" && j.lastProgress ? <div className="text-[10px] text-slate-500 mt-0.5">{j.lastProgress}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{j.attempts}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => void toggleLog(j.id)} className="px-2 py-1 rounded border text-xs hover:bg-slate-50">Log</button>
                      {["FAILED", "CANCELLED", "NEEDS_USER"].includes(j.status) && <button onClick={() => void jobAction(j.id, "retry")} disabled={busyJob === j.id} className="ml-1 px-2 py-1 rounded border text-xs text-sky-700 hover:bg-sky-50 disabled:opacity-50">Reintentar</button>}
                      {j.status !== "PREPARED_PENDING_SIGNATURE" && j.status !== "CANCELLED" && <button onClick={() => void jobAction(j.id, "cancel")} disabled={busyJob === j.id} className="ml-1 px-2 py-1 rounded border text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50">Cancelar</button>}
                    </td>
                  </tr>
                  {openLog === j.id && (
                    <tr className="border-t bg-slate-50">
                      <td colSpan={6} className="px-3 py-2">
                        <div className="text-xs text-slate-600 space-y-1">
                          {logItems.length === 0 ? <div className="text-slate-400">Sin eventos.</div> : logItems.map((e, i) => (
                            <div key={i} className="flex gap-2">
                              <span className="text-slate-400 tabular-nums">{new Date(e.createdAt).toLocaleString("es-ES")}</span>
                              <span className="font-medium">{(e.fromStatus ? `${e.fromStatus} → ` : "") + e.toStatus}</span>
                              {e.note ? <span className="text-slate-500">· {e.note}</span> : null}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500">El agente prepara la remesa en Santander reutilizando la anterior y la deja <strong>pendiente de firma</strong>. Nunca firma ni ejecuta el cobro. Ante login/OTP/CAPTCHA/cambios o discrepancias, pausa y pide intervención.</p>
      </div>
    </div>
  );
}
