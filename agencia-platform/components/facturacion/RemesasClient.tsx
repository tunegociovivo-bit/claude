"use client";

import { useEffect, useState } from "react";

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
  const [tab, setTab] = useState<"requests" | "clients">("requests");
  return (
    <div className="space-y-4">
      {issuerMissing && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          No existe la empresa emisora <strong>Negocio Vivo S.C.A.</strong> en este workspace. Créala en Emisores para poder generar remesas.
        </div>
      )}
      {providerStatus !== "CONFIGURED" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          ⚠️ <strong>Integración Santander pendiente de configurar.</strong> Aprobar una remesa NO firma ni ejecuta el cobro: solo la deja lista. La preparación/firma real en el banco no está disponible todavía.
        </div>
      )}
      <div className="inline-flex rounded-lg border bg-white overflow-hidden text-sm">
        <button onClick={() => setTab("requests")} className={"px-3 py-1.5 " + (tab === "requests" ? "bg-brand-600 text-white font-semibold" : "text-slate-600 hover:bg-slate-50")}>Solicitudes</button>
        <button onClick={() => setTab("clients")} className={"px-3 py-1.5 border-l " + (tab === "clients" ? "bg-brand-600 text-white font-semibold" : "text-slate-600 hover:bg-slate-50")}>Clientes SEPA</button>
      </div>
      {tab === "requests" ? <RequestsTab /> : <ClientsTab />}
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
      setMsg(`Examinadas ${j.examined} facturas · ${j.eligible} elegibles · ${j.created} solicitudes creadas · ${j.skipped} ya existían/omitidas.`);
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
