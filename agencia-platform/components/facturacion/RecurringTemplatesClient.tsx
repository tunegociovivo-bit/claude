"use client";

/**
 * Facturas recurrentes (Slice A · solo lectura + import con preview).
 *
 * Lista las PLANTILLAS recurrentes (tabla separada de las facturas emitidas) con
 * resumen mensual/anual y estados, y un asistente de importación CSV/JSON con
 * PREVIEW (dry-run) antes de guardar como borrador. NO emite/envía/cobra. La
 * pausa masiva y la edición llegan en slices posteriores.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Repeat, Upload, AlertTriangle, CheckCircle2, RefreshCw, Loader2 } from "lucide-react";

type Item = {
  id: string;
  status: string;
  source: string;
  clientName: string | null;
  totalCents: number;
  currency: string;
  intervalMonths: number;
  nextIssueAt: string | null;
  pausedInHolded: boolean;
  syncStatus: string;
};
type Summary = { active: number; paused: number; draft: number; error: number; monthlyCents: number; annualCents: number };
type PreviewItem = { externalId: string; ok: boolean; errors: { field: string; message: string }[] };
type Preview = { total: number; valid: number; invalid: number; duplicatesInFile: number; items: PreviewItem[] };

const eur = (cents: number, currency = "EUR") => `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === "USD" ? "$" : "€"}`;
const period = (m: number) => (m === 1 ? "Mensual" : m === 3 ? "Trimestral" : m === 12 ? "Anual" : `Cada ${m} meses`);
const STATUS_LABEL: Record<string, string> = { active: "Activa", paused: "Pausada", draft: "Borrador", archived: "Archivada" };

export default function RecurringTemplatesClient() {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = useState<Item[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    setState("loading");
    const sp = new URLSearchParams();
    if (statusFilter !== "all") sp.set("status", statusFilter);
    fetch(`/api/v1/facturacion/recurring-templates${sp.toString() ? `?${sp}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        setItems(d.items ?? []);
        setSummary(d.summary ?? null);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? items.filter((i) => (i.clientName ?? "").toLowerCase().includes(needle)) : items;
  }, [items, q]);

  return (
    <section aria-label="Facturas recurrentes" className="space-y-4">
      <h2 className="sr-only">Facturas recurrentes (plantillas)</h2>

      {/* Resumen */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Kpi label="Activas" value={String(summary.active)} />
          <Kpi label="Pausadas" value={String(summary.paused)} />
          <Kpi label="Borrador" value={String(summary.draft)} />
          <Kpi label="Con error" value={String(summary.error)} tone={summary.error ? "rose" : undefined} />
          <Kpi label="Recurrente / mes (activas)" value={eur(summary.monthlyCents)} wide />
          <Kpi label="Recurrente / año (activas)" value={eur(summary.annualCents)} wide />
        </div>
      )}

      <ImportWizard onImported={load} />
      <BackfillPanel onChanged={load} />

      {/* Controles */}
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Filtrar por estado" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-2 py-1.5 rounded-lg bg-white border text-xs">
          <option value="all">Todos los estados</option>
          <option value="active">Activas</option>
          <option value="paused">Pausadas</option>
          <option value="draft">Borrador</option>
          <option value="archived">Archivadas</option>
        </select>
        <input type="search" aria-label="Buscar por cliente" placeholder="Buscar cliente…" value={q} onChange={(e) => setQ(e.target.value)} className="px-2 py-1.5 rounded-lg bg-white border text-xs flex-1 min-w-[8rem]" />
        <button type="button" onClick={load} className="px-2 py-1.5 rounded-lg border text-xs text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1">
          <RefreshCw aria-hidden className="h-3.5 w-3.5" /> Recargar
        </button>
      </div>

      {/* Estados */}
      {state === "loading" && <p className="text-sm text-slate-500" role="status">Cargando plantillas…</p>}
      {state === "error" && (
        <div className="text-sm text-rose-600" role="alert">
          No se pudieron cargar las plantillas.{" "}
          <button type="button" onClick={load} className="underline">Reintentar</button>
        </div>
      )}
      {state === "ready" && visible.length === 0 && (
        <p className="text-sm text-slate-500" role="status">Aún no hay plantillas recurrentes. Importa desde Holded (CSV) para empezar.</p>
      )}

      {/* Lista (plantillas — NUNCA facturas emitidas) */}
      {state === "ready" && visible.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b">
                <th className="py-2 pr-3">Cliente</th>
                <th className="py-2 pr-3">Importe</th>
                <th className="py-2 pr-3">Periodicidad</th>
                <th className="py-2 pr-3">Próxima emisión</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3">Origen</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((it) => (
                <tr key={it.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-1.5">
                      <Repeat aria-hidden className="h-3.5 w-3.5 text-violet-500" />
                      {it.clientName ?? "—"}
                    </span>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{eur(it.totalCents, it.currency)}</td>
                  <td className="py-2 pr-3 text-slate-600">{period(it.intervalMonths)}</td>
                  <td className="py-2 pr-3 text-slate-600">{it.nextIssueAt ? new Date(it.nextIssueAt).toLocaleDateString("es-ES") : "—"}</td>
                  <td className="py-2 pr-3">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${badge(it.status)}`}>{STATUS_LABEL[it.status] ?? it.status}</span>
                    {it.pausedInHolded && <span className="ml-1 text-[11px] text-slate-400">· pausada en Holded</span>}
                    {it.syncStatus === "error" && <AlertTriangle aria-label="error de sincronización" className="inline h-3.5 w-3.5 text-rose-500 ml-1" />}
                  </td>
                  <td className="py-2 pr-3 text-[11px] text-slate-500">{it.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function badge(status: string): string {
  switch (status) {
    case "active":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "paused":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "archived":
      return "bg-slate-50 text-slate-500 border-slate-200";
    default:
      return "bg-sky-50 text-sky-700 border-sky-200";
  }
}

function Kpi({ label, value, tone, wide }: { label: string; value: string; tone?: "rose"; wide?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-3 ${wide ? "col-span-2" : ""}`}>
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`text-lg font-semibold ${tone === "rose" ? "text-rose-700" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}

type BackfillReport = { total: number; toCreate: number; toUpdate: number; unchanged: number; conflicts: number; items?: { legacyInvoiceId: string; action: string; clientName: string | null; conflicts: { code: string; message: string }[] }[] };

function BackfillPanel({ onChanged }: { onChanged: () => void }) {
  const [report, setReport] = useState<BackfillReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = useCallback(
    (mode: "preview" | "commit" | "rollback") => {
      setBusy(true);
      setMsg(null);
      fetch("/api/v1/facturacion/recurring-templates/backfill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) })
        .then((r) => r.json())
        .then((d) => {
          if (d?.error) setMsg(d.error.message);
          else if (mode === "preview") setReport(d);
          else if (mode === "commit") {
            setMsg(`Migradas: ${d.created} nuevas, ${d.updated} actualizadas, ${d.unchanged} sin cambios, ${d.conflicts} con conflicto${Array.isArray(d.errors) && d.errors.length ? `, ⚠ ${d.errors.length} error(es)` : ""}.`);
            setReport(null);
            onChanged();
          } else {
            setMsg(`Revertidas ${d.deleted} plantilla(s) migradas del legado.`);
            setReport(null);
            onChanged();
          }
        })
        .catch(() => setMsg("No se pudo ejecutar el backfill."))
        .finally(() => setBusy(false));
    },
    [onChanged]
  );

  return (
    <details className="rounded-xl border bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-800 inline-flex items-center gap-2">
        <RefreshCw aria-hidden className="h-4 w-4 text-slate-500" /> Migrar recurrentes del sistema anterior (legado)
      </summary>
      <div className="px-4 pb-4 space-y-3">
        <p className="text-xs text-slate-500">
          Copia las facturas recurrentes del sistema anterior a esta sección como <strong>borrador</strong>, sin tocar las facturas ni el sistema que las emite hoy. Primero
          <strong> previsualiza</strong>; la migración es idempotente y <strong>reversible</strong>.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={() => run("preview")} className="px-3 py-1.5 rounded-lg border text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-1">
            {busy ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null} Previsualizar
          </button>
          {report && report.total > 0 && report.conflicts < report.total && (
            <button type="button" disabled={busy} onClick={() => run("commit")} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-1">
              <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Migrar {report.toCreate + report.toUpdate}
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => run("rollback")} className="px-3 py-1.5 rounded-lg border text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50">
            Revertir migración
          </button>
        </div>
        {msg && <p className="text-xs text-slate-700" role="status">{msg}</p>}
        {report && (
          <div className="text-xs space-y-2">
            <div className="flex flex-wrap gap-3">
              <span className="text-slate-600">Total legado: {report.total}</span>
              <span className="text-emerald-700">Crear: {report.toCreate}</span>
              <span className="text-sky-700">Actualizar: {report.toUpdate}</span>
              <span className="text-slate-500">Sin cambios: {report.unchanged}</span>
              <span className="text-rose-700">Conflictos: {report.conflicts}</span>
            </div>
            {(report.items ?? []).filter((i) => i.action === "conflict").length > 0 && (
              <ul className="space-y-1">
                {(report.items ?? [])
                  .filter((i) => i.action === "conflict")
                  .slice(0, 20)
                  .map((i) => (
                    <li key={i.legacyInvoiceId} className="text-rose-600">
                      <span className="font-mono">{i.legacyInvoiceId}</span> ({i.clientName ?? "—"}): {i.conflicts.map((c) => c.message).join("; ")}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

function ImportWizard({ onImported }: { onImported: () => void }) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const doPreview = useCallback(() => {
    setBusy(true);
    setMsg(null);
    fetch("/api/v1/facturacion/recurring-templates/import/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "csv", content: csv }) })
      .then((r) => r.json())
      .then((d) => (d?.error ? setMsg(d.error.message) : setPreview(d)))
      .catch(() => setMsg("No se pudo previsualizar."))
      .finally(() => setBusy(false));
  }, [csv]);

  const doImport = useCallback(() => {
    setBusy(true);
    setMsg(null);
    fetch("/api/v1/facturacion/recurring-templates/import/commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "csv", content: csv, source: "CSV_IMPORT" }) })
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) setMsg(d.error.message);
        else {
          const failed = Array.isArray(d.errors) ? d.errors.length : 0;
          setMsg(
            `Importado: ${d.created} nuevas, ${d.updated} actualizadas, ${d.unchanged} sin cambios` +
              `${d.skippedInvalid ? `, ${d.skippedInvalid} inválidas omitidas` : ""}` +
              `${failed ? `, ⚠ ${failed} fallaron al guardar` : ""}.`
          );
          setPreview(null);
          onImported();
        }
      })
      .catch(() => setMsg("No se pudo importar."))
      .finally(() => setBusy(false));
  }, [csv, onImported]);

  return (
    <details className="rounded-xl border bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-800 inline-flex items-center gap-2">
        <Upload aria-hidden className="h-4 w-4 text-slate-500" /> Importar recurrentes (CSV de Holded)
      </summary>
      <div className="px-4 pb-4 space-y-3">
        <p className="text-xs text-slate-500">
          Pega el CSV exportado de Holded o uno propio. Columnas: <code>externalId, clientName, clientTaxId, description, unitPrice, quantity, taxRate, intervalMonths, dayOfMonth, startDate, paymentMethod</code>. La importación
          <strong> no emite ni envía nada</strong>: crea borradores. Reimportar el mismo fichero no duplica.
        </p>
        <textarea
          aria-label="CSV de plantillas recurrentes"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={5}
          placeholder="externalId,clientName,description,unitPrice,taxRate,intervalMonths…"
          className="w-full px-2 py-1.5 rounded-lg border text-xs font-mono"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy || !csv.trim()} onClick={doPreview} className="px-3 py-1.5 rounded-lg border text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-1">
            {busy ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null} Previsualizar
          </button>
          {preview && preview.valid > 0 && (
            <button type="button" disabled={busy} onClick={doImport} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-1">
              <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Importar {preview.valid} válidas
            </button>
          )}
        </div>
        {msg && <p className="text-xs text-slate-700" role="status">{msg}</p>}
        {preview && (
          <div className="text-xs space-y-2">
            <div className="flex flex-wrap gap-3">
              <span className="text-emerald-700">Válidas: {preview.valid}</span>
              <span className="text-rose-700">Inválidas: {preview.invalid}</span>
              <span className="text-amber-700">Duplicadas en fichero: {preview.duplicatesInFile}</span>
            </div>
            {preview.items.filter((i) => !i.ok).length > 0 && (
              <ul className="space-y-1">
                {preview.items
                  .filter((i) => !i.ok)
                  .slice(0, 20)
                  .map((i) => (
                    <li key={i.externalId} className="text-rose-600">
                      <span className="font-mono">{i.externalId}</span>: {i.errors.map((e) => `${e.field} — ${e.message}`).join("; ")}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
