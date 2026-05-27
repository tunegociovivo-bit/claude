"use client";

import { useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { ArrowLeft, Loader2, KeyRound, CheckCircle2, AlertTriangle, FileText } from "lucide-react";

type Match = {
  header: string;
  contentPreview: string;
  contentLength: number;
  clientId: string | null;
  clientName: string | null;
  matchType: "exact" | "contains" | "none";
  existingAccesosLength: number;
  willSkip: boolean;
};

export default function ImportAccesosClient() {
  const [text, setText] = useState("");
  const [onConflict, setOnConflict] = useState<"skip" | "overwrite" | "append">("skip");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Match[] | null>(null);
  const [applied, setApplied] = useState<{ updated: number; skipped: number; skippedReasons: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function doPreview() {
    if (!text.trim()) {
      setError("Pega el contenido de la tarea antes");
      return;
    }
    setError(null);
    setApplied(null);
    setLoading(true);
    try {
      const r = await fetch("/api/v1/admin/import-accesos-from-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, apply: false, onConflict })
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data?.error?.message ?? `Error ${r.status}`);
        return;
      }
      setPreview(data.matches ?? []);
    } finally {
      setLoading(false);
    }
  }

  async function doApply() {
    if (!preview) return;
    const ok = preview.filter((m) => !m.willSkip).length;
    if (!confirm(`Aplicar ${ok} actualizaciones de accesos?\n\nLos bloques marcados como "skip" no se tocan.`)) return;
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/api/v1/admin/import-accesos-from-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, apply: true, onConflict })
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data?.error?.message ?? `Error ${r.status}`);
        return;
      }
      setApplied({
        updated: data.updated,
        skipped: data.skipped,
        skippedReasons: data.skippedReasons ?? []
      });
      setPreview(null);
      setText("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <Link href="/admin" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />
        Volver al panel admin
      </Link>

      <PageHeader
        title="Importar accesos desde tarea"
        description="Pega el contenido de la tarea donde tienes los accesos de todos los clientes. Detectamos un bloque por cliente y los volcamos al campo 'Accesos' de su ficha."
      />

      <div className="bg-white rounded-xl border p-5 space-y-4">
        <div className="flex items-start gap-3 text-sm text-slate-700 bg-amber-50 border border-amber-200 rounded p-3">
          <FileText className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Heurística de detección de cabeceras:</p>
            <ul className="text-xs mt-1 list-disc ml-4 space-y-0.5">
              <li>Líneas en MAYÚSCULAS (3+ caracteres, ≤80)</li>
              <li>Markdown # / ## / ###</li>
              <li>Texto en **negrita**</li>
              <li>Líneas terminadas en ":" (que no sean user/password/url/…)</li>
            </ul>
            <p className="text-xs mt-2">
              Si el formato de tu tarea es muy distinto, dame un ejemplo y ajusto el parser. Hay un preview antes de aplicar nada.
            </p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Contenido pegado de la tarea</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            placeholder={`CLIENTE EJEMPLO\nWordPress: cliente.com/wp-admin · admin · pass123\ncPanel: cpanel.cliente.com · user · pass\n\nOTRO CLIENTE\nGMB: cliente@gmail.com (2FA en móvil de Pedro)\nMetricool: admin@cliente.com`}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-slate-700">Si el cliente ya tiene accesos:</label>
          <select
            value={onConflict}
            onChange={(e) => setOnConflict(e.target.value as any)}
            className="px-3 py-1.5 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="skip">No tocar (saltar)</option>
            <option value="overwrite">Sobreescribir</option>
            <option value="append">Añadir al final</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={doPreview}
            disabled={loading || !text.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm font-medium disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Previsualizar parseo
          </button>
          {preview && (
            <button
              onClick={doApply}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Aplicar
            </button>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <strong>Error:</strong> {error}
          </div>
        )}

        {applied && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 space-y-1">
            <div className="font-medium flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" />
              Aplicado
            </div>
            <p>
              Actualizados: <strong>{applied.updated}</strong> · Saltados: <strong>{applied.skipped}</strong>
            </p>
            {applied.skippedReasons.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs">Razones de skip</summary>
                <ul className="ml-4 mt-1 list-disc text-xs">
                  {applied.skippedReasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </details>
            )}
            <p className="text-xs">
              <Link href="/clientes" className="underline">Ir a Clientes →</Link>
            </p>
          </div>
        )}

        {preview && (
          <div className="border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b text-xs font-medium">
              {preview.length} bloque(s) detectado(s)
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b text-slate-500">
                <tr>
                  <th className="text-left px-3 py-1.5">Cabecera detectada</th>
                  <th className="text-left px-3 py-1.5">Cliente matcheado</th>
                  <th className="text-left px-3 py-1.5">Contenido</th>
                  <th className="text-left px-3 py-1.5">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {preview.map((m, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 font-medium">{m.header}</td>
                    <td className="px-3 py-2">
                      {m.clientName ? (
                        <span
                          className={
                            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border " +
                            (m.matchType === "exact"
                              ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                              : "bg-amber-50 border-amber-300 text-amber-800")
                          }
                          title={m.matchType === "exact" ? "Match exacto" : "Match parcial — revisar"}
                        >
                          {m.matchType === "exact" ? "✓" : "≈"} {m.clientName}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-rose-50 border-rose-300 text-rose-700">
                          <AlertTriangle className="h-3 w-3" /> Sin match
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      <div className="line-clamp-2 max-w-[280px] text-[11px]">{m.contentPreview}</div>
                      <div className="text-[10px] text-slate-400">{m.contentLength} chars</div>
                    </td>
                    <td className="px-3 py-2">
                      {m.willSkip ? (
                        <span className="text-rose-600 text-[11px] font-medium">SKIP</span>
                      ) : (
                        <span className="text-emerald-700 text-[11px] font-medium">
                          {m.existingAccesosLength > 0 ? onConflict.toUpperCase() : "CREAR"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
