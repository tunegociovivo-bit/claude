"use client";

import { useMemo, useRef, useState } from "react";
import { Upload, FileText, Users, Receipt, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { formatMoney } from "@/lib/invoicing/core";

type Entity = "clients" | "invoices";

type ClientPlanItem = {
  input: any;
  action: "create" | "merge" | "noop" | "skip";
  matchName?: string;
  fillFields: string[];
  reason?: string;
};
type InvoicePlanItem = {
  input: any;
  action: "create" | "skip";
  reason?: string;
  clientMatchName?: string;
  clientUnmatched?: boolean;
  computedTotalCents: number;
  currency: string;
};

type PreviewResp = {
  entity: Entity;
  format: string;
  count: number;
  inputs: any[];
  plan: (ClientPlanItem | InvoicePlanItem)[];
};

const FIELD_LABELS: Record<string, string> = {
  legalName: "razón social",
  taxId: "NIF/CIF",
  email: "email",
  phone: "teléfono",
  fiscalAddress: "dirección",
  postalCode: "C.P.",
  city: "ciudad",
  province: "provincia",
  industry: "sector",
  contactName: "contacto",
  mrr: "MRR",
  notes: "notas"
};

export default function ImporterClient() {
  const [entity, setEntity] = useState<Entity>("clients");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setPreview(null);
    setSelected(new Set());
    setResult(null);
    setError(null);
  }

  async function analyze() {
    if (!file) return setError("Selecciona un archivo");
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("entity", entity);
      const r = await fetch("/api/v1/admin/import/preview", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) {
        setError(data?.error?.message ?? data?.message ?? `Error ${r.status}`);
        return;
      }
      const resp = data as PreviewResp;
      setPreview(resp);
      // Pre-seleccionar las filas accionables.
      const sel = new Set<number>();
      resp.plan.forEach((p, i) => {
        if (p.action === "create" || p.action === "merge") sel.add(i);
      });
      setSelected(sel);
    } catch (e: any) {
      setError(e?.message ?? "Error al analizar");
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    if (!preview) return;
    const inputs = preview.plan.filter((_, i) => selected.has(i)).map((p) => p.input);
    if (inputs.length === 0) return setError("No hay filas seleccionadas");
    setApplying(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/admin/import/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity: preview.entity, inputs })
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data?.error?.message ?? data?.message ?? `Error ${r.status}`);
        return;
      }
      if (entity === "clients") {
        setResult(`Importación completada: ${data.created} creados, ${data.merged} completados, ${data.skipped} sin cambios.`);
      } else {
        setResult(`Importación completada: ${data.created} facturas creadas, ${data.skipped} omitidas (duplicadas).`);
      }
      setPreview(null);
      setSelected(new Set());
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e: any) {
      setError(e?.message ?? "Error al importar");
    } finally {
      setApplying(false);
    }
  }

  const counts = useMemo(() => {
    if (!preview) return null;
    const c = { create: 0, merge: 0, noop: 0, skip: 0 };
    preview.plan.forEach((p) => {
      c[p.action as keyof typeof c]++;
    });
    return c;
  }, [preview]);

  function toggle(i: number) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  }

  return (
    <div className="space-y-5">
      {/* Selector de entidad */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => {
            setEntity("clients");
            reset();
          }}
          className={`flex items-center gap-3 p-4 rounded-xl border text-left ${
            entity === "clients" ? "border-brand-500 bg-brand-50" : "bg-white hover:bg-slate-50"
          }`}
        >
          <Users className="h-5 w-5 text-brand-600" />
          <div>
            <div className="font-medium text-sm">Clientes</div>
            <div className="text-xs text-slate-500">Rellena datos que falten; no sobrescribe.</div>
          </div>
        </button>
        <button
          onClick={() => {
            setEntity("invoices");
            reset();
          }}
          className={`flex items-center gap-3 p-4 rounded-xl border text-left ${
            entity === "invoices" ? "border-brand-500 bg-brand-50" : "bg-white hover:bg-slate-50"
          }`}
        >
          <Receipt className="h-5 w-5 text-brand-600" />
          <div>
            <div className="font-medium text-sm">Facturas</div>
            <div className="text-xs text-slate-500">Crea facturas; omite duplicadas por número.</div>
          </div>
        </button>
      </div>

      {/* Subida */}
      <div className="bg-white border rounded-xl p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls,.pdf,text/csv,application/pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              reset();
            }}
            className="text-sm"
          />
          <button
            onClick={analyze}
            disabled={loading || !file}
            className="inline-flex items-center gap-1.5 bg-brand-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Analizar archivo
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
          <FileText className="h-3.5 w-3.5" /> Formatos: PDF, CSV, Excel (.xlsx/.xls). El PDF se interpreta con IA (requiere
          tener la IA configurada).
        </p>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {result && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg p-3 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {result}
        </div>
      )}

      {/* Preview */}
      {preview && counts && (
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b flex flex-wrap items-center gap-3 text-xs">
            <span className="font-medium text-sm">{preview.count} filas detectadas</span>
            <Badge color="emerald">{counts.create} nuevos</Badge>
            {entity === "clients" && <Badge color="blue">{counts.merge} a completar</Badge>}
            {entity === "clients" && <Badge color="slate">{counts.noop} sin cambios</Badge>}
            <Badge color="slate">{counts.skip} omitidas</Badge>
            <div className="flex-1" />
            <button
              onClick={apply}
              disabled={applying || selected.size === 0}
              className="inline-flex items-center gap-1.5 bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 disabled:opacity-50"
            >
              {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Importar {selected.size} seleccionadas
            </button>
          </div>

          <div className="max-h-[480px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase sticky top-0">
                <tr>
                  <th className="px-3 py-2 w-8"></th>
                  {entity === "clients" ? (
                    <>
                      <th className="text-left px-3 py-2">Cliente</th>
                      <th className="text-left px-3 py-2">Acción</th>
                      <th className="text-left px-3 py-2">Detalle</th>
                    </>
                  ) : (
                    <>
                      <th className="text-left px-3 py-2">Número</th>
                      <th className="text-left px-3 py-2">Cliente</th>
                      <th className="text-right px-3 py-2">Total</th>
                      <th className="text-left px-3 py-2">Acción</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {preview.plan.map((p, i) => {
                  const actionable = p.action === "create" || p.action === "merge";
                  return (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          disabled={!actionable}
                          checked={selected.has(i)}
                          onChange={() => toggle(i)}
                        />
                      </td>
                      {entity === "clients" ? (
                        <ClientRow item={p as ClientPlanItem} />
                      ) : (
                        <InvoiceRow item={p as InvoicePlanItem} />
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ClientRow({ item }: { item: ClientPlanItem }) {
  return (
    <>
      <td className="px-3 py-2 font-medium">{item.input.name}</td>
      <td className="px-3 py-2">
        {item.action === "create" && <Badge color="emerald">Nuevo</Badge>}
        {item.action === "merge" && <Badge color="blue">Completar</Badge>}
        {item.action === "noop" && <Badge color="slate">Sin cambios</Badge>}
        {item.action === "skip" && <Badge color="slate">Omitir</Badge>}
      </td>
      <td className="px-3 py-2 text-slate-500 text-xs">
        {item.action === "merge" && (
          <>
            Añade: {item.fillFields.map((f) => FIELD_LABELS[f] ?? f).join(", ")}
            {item.matchName ? ` · en "${item.matchName}"` : ""}
          </>
        )}
        {item.action === "noop" && `Ya registrado${item.matchName ? `: "${item.matchName}"` : ""}`}
        {item.action === "skip" && (item.reason ?? "")}
        {item.action === "create" && (item.input.taxId ? `NIF ${item.input.taxId}` : "")}
      </td>
    </>
  );
}

function InvoiceRow({ item }: { item: InvoicePlanItem }) {
  return (
    <>
      <td className="px-3 py-2 font-medium">{item.input.number ?? "(sin nº)"}</td>
      <td className="px-3 py-2 text-slate-600">
        {item.input.clientName ?? "—"}
        {item.clientUnmatched && item.action === "create" && (
          <span className="ml-1 text-[11px] text-amber-600">(cliente no encontrado)</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">{formatMoney(item.computedTotalCents, item.currency)}</td>
      <td className="px-3 py-2">
        {item.action === "create" ? <Badge color="emerald">Nueva</Badge> : <Badge color="slate">{item.reason ?? "Omitir"}</Badge>}
      </td>
    </>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: "emerald" | "blue" | "slate" | "amber" }) {
  const cls: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700",
    blue: "bg-blue-50 text-blue-700",
    slate: "bg-slate-100 text-slate-600",
    amber: "bg-amber-50 text-amber-700"
  };
  return <span className={`text-[11px] px-2 py-0.5 rounded-md ${cls[color]}`}>{children}</span>;
}
