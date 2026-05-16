"use client";

import { useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { ArrowLeft, Loader2, FileSpreadsheet, CheckCircle2 } from "lucide-react";

export default function ImportClientsListClient() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!confirm("¿Importar el listado de clientes? Los que ya existen (por nombre) se SALTAN sin tocar nada. Los nuevos se crean con su prioridad y servicios.")) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/v1/admin/import-clients-list", { method: "POST" });
      const data = await r.json();
      if (!r.ok) {
        setError(data?.error?.message ?? `Error ${r.status}`);
      } else {
        setResult(data);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link href="/admin" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />
        Volver al panel admin
      </Link>

      <PageHeader
        title="Importar listado de clientes"
        description="Maqueta los 71 clientes del Sheet del usuario (2026-05-17) en la sección Clientes. Idempotente: los ya existentes no se tocan."
      />

      <div className="bg-white rounded-xl border p-6 space-y-4">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="h-6 w-6 text-violet-600 shrink-0" />
          <div className="text-sm text-slate-700">
            <p>
              <strong>Fuente:</strong> Google Sheet "Listado clientes 2026-05-17" (71 entradas, ISABEL MECA duplicada se dedupea).
            </p>
            <p className="mt-1">
              Para cada entrada se rellena: <code className="text-xs bg-slate-100 px-1 rounded">name</code>,{" "}
              <code className="text-xs bg-slate-100 px-1 rounded">status</code> (ACTIVE si "ES CLIENTE = SI", PROSPECT si NO),{" "}
              <code className="text-xs bg-slate-100 px-1 rounded">prioridad</code> (ALTA/NORMAL/BAJA),{" "}
              <code className="text-xs bg-slate-100 px-1 rounded">servicios</code> (slugs mapeados desde el texto del sheet),{" "}
              <code className="text-xs bg-slate-100 px-1 rounded">notes</code> si la columna NOTA tenía contenido.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Los clientes que ya existen en tu BD (case-insensitive por nombre) se SALTAN sin modificar nada. Tu cliente actual{" "}
              <em>Clinica March</em> probablemente no matchea con "CLÍNICA CAPILAR MARCH" del sheet — si hay duplicado tras el import, bórralo manualmente.
            </p>
          </div>
        </div>

        <div>
          <button
            onClick={run}
            disabled={running}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Importar listado ahora
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <strong>Error:</strong> {error}
          </div>
        )}

        {result && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <div className="flex items-center gap-2 font-medium mb-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Import completado
            </div>
            <ul className="space-y-1 text-xs">
              <li>Total en sheet: <strong>{result.total}</strong></li>
              <li>Creados nuevos: <strong>{result.created}</strong></li>
              <li>Saltados (ya existían): <strong>{result.skipped}</strong></li>
            </ul>
            {Array.isArray(result.createdItems) && result.createdItems.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-emerald-700">Ver primeros creados</summary>
                <ul className="ml-4 mt-1 list-disc text-xs">
                  {result.createdItems.map((c: any) => (
                    <li key={c.id}>{c.name}</li>
                  ))}
                </ul>
              </details>
            )}
            {Array.isArray(result.skippedItems) && result.skippedItems.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-emerald-700">Ver primeros saltados</summary>
                <ul className="ml-4 mt-1 list-disc text-xs">
                  {result.skippedItems.map((n: string) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
            <p className="mt-2 text-xs">
              <Link href="/clientes" className="underline">Ir a Clientes →</Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
