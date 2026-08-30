"use client";

/**
 * Facturas recurrentes (admin). Consume /api/v1/facturacion/recurring:
 *   - GET   → lista de plantillas (activas/pausadas).
 *   - POST {dryRun:true}  → previsualiza el import desde Holded (no escribe).
 *   - POST {dryRun:false} → importa plantillas PAUSADAS (no emite facturas).
 *   - PATCH /{id} {action} → pausa/activa (activación gradual).
 *   - POST /pause-all     → pausa global de emergencia.
 * Estados de carga / vacío / error. Nunca emite facturas reales desde aquí.
 */
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { RefreshCw, Download, Play, Pause, ShieldAlert, Repeat, Pencil, X } from "lucide-react";

type Template = { id: string; holdedRecurringId: string | null; status: "active" | "paused"; contactName: string | null; totalCents: number; currency: "EUR" | "USD"; intervalMonths: number | null; intervalUnit: "DAYS" | "MONTHS" | "YEARS"; intervalValue: number; nextRunAt: string | null; recipientEmail: string | null; description: string | null; sendAutomatically: boolean; bccEmails: string[] };
type ListResp = { templates: Template[]; summary: { total: number; active: number; paused: number } };

const money = (c: number, cur: string) => `${(c / 100).toFixed(2)} ${cur}`;
const intervalLabel = (t: Template) => `${t.intervalValue} ${t.intervalUnit === "DAYS" ? (t.intervalValue === 1 ? "día" : "días") : t.intervalUnit === "YEARS" ? (t.intervalValue === 1 ? "año" : "años") : (t.intervalValue === 1 ? "mes" : "meses")}`;

export default function FacturacionRecurrentesPage() {
  const [data, setData] = useState<ListResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch("/api/v1/facturacion/recurring");
      if (!r.ok) throw new Error(`Error ${r.status}`);
      setData(await r.json());
    } catch (e: any) { setErr(String(e?.message ?? "error")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function runImport(dryRun: boolean) {
    setBusy(true); setErr(null); setPreview(null);
    try {
      const r = await fetch("/api/v1/facturacion/recurring", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dryRun }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? `Error ${r.status}`);
      if (dryRun) setPreview(d); else { setPreview(null); await load(); }
    } catch (e: any) { setErr(String(e?.message ?? "error")); }
    finally { setBusy(false); }
  }
  async function setStatus(id: string, action: "pause" | "resume") {
    await fetch(`/api/v1/facturacion/recurring/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    load();
  }
  async function pauseAll() {
    if (!confirm("¿Pausar TODAS las recurrencias del workspace? No se emitirá ninguna factura hasta reactivarlas.")) return;
    await fetch("/api/v1/facturacion/recurring/pause-all", { method: "POST" });
    load();
  }

  async function saveTemplate(value: Template) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/v1/facturacion/recurring/${value.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intervalUnit: value.intervalUnit, intervalValue: Number(value.intervalValue),
          recipientEmail: value.recipientEmail?.trim(), totalCents: Number(value.totalCents),
          currency: value.currency, nextRunAt: new Date(value.nextRunAt!).toISOString(),
          sendAutomatically: value.sendAutomatically, contactName: value.contactName ?? "",
          description: value.description ?? "", bccEmails: value.bccEmails
        })
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error?.message ?? "No se pudo guardar la recurrencia");
      setEditing(null); await load();
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Facturas recurrentes" description="Importa las recurrencias de Holded (pausadas), revísalas y actívalas gradualmente." />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button onClick={load} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-white text-sm hover:bg-slate-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualizar</button>
        <button onClick={() => runImport(true)} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-white text-sm hover:bg-slate-50 disabled:opacity-50"><Download className="h-4 w-4" /> Dry-run import</button>
        <button onClick={() => runImport(false)} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm hover:bg-brand-700 disabled:opacity-50"><Download className="h-4 w-4" /> Importar (pausadas)</button>
        <button onClick={pauseAll} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-white text-red-600 text-sm hover:bg-red-50 ml-auto"><Pause className="h-4 w-4" /> Pausa global</button>
      </div>

      {err && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 mb-4 text-sm flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> {err}</div>}

      {preview && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 text-sm">
          <strong>Dry-run:</strong> Holded devolvió {preview.fetched} · a importar {preview.toImport} · ya importadas {preview.alreadyImported} · inválidas {preview.invalid}. (No se ha escrito nada.)
        </div>
      )}

      {data && (
        <div className="grid grid-cols-3 gap-4 mb-4">
          <Stat label="Plantillas" value={data.summary.total} />
          <Stat label="Activas" value={data.summary.active} tone="ok" />
          <Stat label="Pausadas" value={data.summary.paused} tone="warn" />
        </div>
      )}

      <section className="bg-white rounded-xl border overflow-hidden">
        <div className="p-5 border-b flex items-center gap-2"><Repeat className="h-4 w-4 text-slate-400" /><h2 className="font-semibold">Plantillas recurrentes</h2></div>
        {loading && !data ? (
          <div className="p-6 text-sm text-slate-500">Cargando…</div>
        ) : !data || data.templates.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No hay recurrencias. Usa «Dry-run import» para ver las de Holded y luego «Importar (pausadas)».</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 bg-slate-50"><tr>
                <th className="text-left p-3">Cliente</th><th className="text-left p-3">Importe</th><th className="text-left p-3">Cada</th><th className="text-left p-3">Próxima</th><th className="text-left p-3">Estado</th><th className="text-right p-3">Acción</th>
              </tr></thead>
              <tbody className="divide-y">
                {data.templates.map((t) => (
                  <tr key={t.id}>
                    <td className="p-3">{t.contactName ?? <span className="text-slate-400">—</span>}</td>
                    <td className="p-3">{money(t.totalCents, t.currency)}</td>
                    <td className="p-3">{intervalLabel(t)}</td>
                    <td className="p-3 text-slate-500">{t.nextRunAt ? new Date(t.nextRunAt).toLocaleDateString("es-ES") : "—"}</td>
                    <td className="p-3">{t.status === "active" ? <span className="text-emerald-600">● activa</span> : <span className="text-amber-600">⏸ pausada</span>}</td>
                    <td className="p-3 text-right">
                      <button onClick={() => setEditing({ ...t })} className="mr-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /> Editar</button>
                      {t.status === "paused" ? (
                        <button onClick={() => setStatus(t.id, "resume")} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs hover:bg-emerald-50 text-emerald-700"><Play className="h-3.5 w-3.5" /> Activar</button>
                      ) : (
                        <button onClick={() => setStatus(t.id, "pause")} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs hover:bg-amber-50 text-amber-700"><Pause className="h-3.5 w-3.5" /> Pausar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && <RecurringEditor value={editing} busy={busy} onChange={setEditing} onClose={() => setEditing(null)} onSave={() => void saveTemplate(editing)} />}
    </div>
  );
}

function RecurringEditor({ value, busy, onChange, onClose, onSave }: { value: Template; busy: boolean; onChange: (v: Template) => void; onClose: () => void; onSave: () => void }) {
  const input = "mt-1 w-full rounded-lg border px-3 py-2 text-sm";
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
    <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl">
      <div className="flex items-center justify-between border-b p-5"><div><h2 className="font-semibold">Editar factura recurrente</h2><p className="text-xs text-slate-500">Los cambios se aplicarán a las próximas facturas.</p></div><button onClick={onClose}><X className="h-5 w-5" /></button></div>
      <div className="grid gap-4 p-5 md:grid-cols-2">
        <label className="text-xs text-slate-600">Cliente<input className={input} value={value.contactName ?? ""} onChange={(e) => onChange({ ...value, contactName: e.target.value })} /></label>
        <label className="text-xs text-slate-600">Correo de envío<input type="email" required className={input} value={value.recipientEmail ?? ""} onChange={(e) => onChange({ ...value, recipientEmail: e.target.value })} /></label>
        <label className="text-xs text-slate-600 md:col-span-2">Copias ocultas (BCC)<input type="text" className={input} placeholder="info@negociovivo.com, control@empresa.com" value={value.bccEmails.join(", ")} onChange={(e) => onChange({ ...value, bccEmails: e.target.value.split(/[,;\n]/).map((email) => email.trim()).filter(Boolean) })} /><span className="mt-1 block text-[11px] text-slate-500">Puedes separar varias direcciones con comas. El cliente no verá estos destinatarios.</span></label>
        <label className="text-xs text-slate-600">Importe<input type="number" min="0" step="0.01" className={input} value={(value.totalCents / 100).toFixed(2)} onChange={(e) => onChange({ ...value, totalCents: Math.round(Number(e.target.value) * 100) })} /></label>
        <label className="text-xs text-slate-600">Moneda<select className={input} value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value as "EUR" | "USD" })}><option value="EUR">EUR (€)</option><option value="USD">USD ($)</option></select></label>
        <label className="text-xs text-slate-600">Cada<input type="number" min="1" max="3650" className={input} value={value.intervalValue} onChange={(e) => onChange({ ...value, intervalValue: Math.max(1, Number(e.target.value)) })} /></label>
        <label className="text-xs text-slate-600">Periodo<select className={input} value={value.intervalUnit} onChange={(e) => onChange({ ...value, intervalUnit: e.target.value as Template["intervalUnit"] })}><option value="DAYS">día(s)</option><option value="MONTHS">mes(es)</option><option value="YEARS">año(s)</option></select></label>
        <label className="text-xs text-slate-600">Próxima emisión<input type="date" min={new Date().toISOString().slice(0, 10)} className={input} value={value.nextRunAt?.slice(0, 10) ?? ""} onChange={(e) => onChange({ ...value, nextRunAt: `${e.target.value}T00:00:00.000Z` })} /></label>
        <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={value.sendAutomatically} onChange={(e) => onChange({ ...value, sendAutomatically: e.target.checked })} />Enviar automáticamente por correo</label>
        <label className="text-xs text-slate-600 md:col-span-2">Descripción<textarea rows={3} className={input} value={value.description ?? ""} onChange={(e) => onChange({ ...value, description: e.target.value })} /></label>
      </div>
      <div className="flex justify-end gap-2 border-t p-4"><button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button><button disabled={busy || !value.recipientEmail || !value.nextRunAt} onClick={onSave} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Guardando…" : "Guardar cambios"}</button></div>
    </div>
  </div>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-slate-800";
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}
