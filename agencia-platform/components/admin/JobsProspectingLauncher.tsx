"use client";

import { useState } from "react";
import { BriefcaseBusiness, Loader2, Search } from "lucide-react";

type SearchResult = {
  searchId: string;
  status: string;
  offersAdded?: number;
  duplicatesSkipped?: number;
};

type SearchItem = {
  id: string;
  status: string;
  totalResults?: number;
  leadsSkipped?: number;
  errorMessage?: string | null;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function JobsProspectingLauncher({ onCompleted }: { onCompleted: () => void | Promise<void> }) {
  const [keyword, setKeyword] = useState("marketing");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);

  async function waitForCompletion(searchId: string): Promise<SearchResult | null> {
    // El worker interno procesa las búsquedas pendientes cada minuto. El sondeo
    // solo actualiza la UI; si el navegador se cierra, el trabajo continúa.
    for (let attempt = 0; attempt < 120; attempt++) {
      await wait(5_000);
      let item: SearchItem | undefined;
      try {
        const response = await fetch("/api/v1/leads/searches", { cache: "no-store" });
        if (!response.ok) continue;
        const body = await response.json();
        item = (body?.items as SearchItem[] | undefined)?.find((candidate) => candidate.id === searchId);
      } catch {
        continue; // un fallo puntual del sondeo no cancela el trabajo del servidor
      }
      if (!item) continue;

      const next: SearchResult = {
        searchId,
        status: item.status,
        offersAdded: Number(item.totalResults ?? 0),
        duplicatesSkipped: Number(item.leadsSkipped ?? 0)
      };
      setResult(next);
      if (item.status === "COMPLETED") return next;
      if (item.status === "FAILED") {
        throw new Error(item.errorMessage || "La búsqueda no pudo completarse en el servidor.");
      }
      if (item.status === "CANCELLED") throw new Error("La búsqueda fue cancelada.");
    }
    return null;
  }

  async function runSearch() {
    const term = keyword.trim();
    if (term.length < 2) {
      setError("Escribe una palabra clave de al menos 2 caracteres.");
      return;
    }
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/v1/leads/prospecting/jobs/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: term })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || "No se pudo completar la búsqueda de ofertas.");
      const queued = body as SearchResult;
      setResult(queued);
      const completed = await waitForCompletion(queued.searchId);
      if (completed?.status === "COMPLETED") await onCompleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo completar la búsqueda de ofertas.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="mb-5 rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-50 to-indigo-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 font-semibold text-sky-950">
            <BriefcaseBusiness className="h-5 w-5" />
            Encontrar empresas que están contratando
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Recorre hasta 1.000 vacantes de LinkedIn Jobs en toda España, reúne los datos de la empresa y del responsable,
            y prepara el email y el mensaje privado en una sola campaña. Se deduplican empresas ya conocidas.
          </p>
        </div>
        <a href="/admin/leads?tab=jobs-review" className="text-xs font-semibold text-sky-700 hover:underline">
          Ver emails de Empleos →
        </a>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label className="flex-1">
          <span className="sr-only">Palabra clave del puesto</span>
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !running) void runSearch();
            }}
            disabled={running}
            placeholder="marketing, community manager, SEO, inteligencia artificial…"
            className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-sky-500 disabled:opacity-60"
          />
        </label>
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={running || keyword.trim().length < 2}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {running ? "Buscando y preparando contactos…" : "Buscar en LinkedIn y preparar contacto"}
        </button>
      </div>

      <p className="mt-2 text-[11px] text-slate-500">
        Los emails respetan el modo configurado en Empleos. LinkedIn queda siempre asistido para revisar el texto antes de enviarlo.
      </p>
      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {result && ["PENDING", "RUNNING"].includes(result.status) && (
        <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          Búsqueda iniciada y procesándose en segundo plano. Puedes seguir usando la plataforma; los resultados aparecerán al terminar.
        </p>
      )}
      {result?.status === "COMPLETED" && (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Búsqueda completada: <strong>{result.offersAdded ?? 0}</strong> empresa(s) nueva(s) y <strong>{result.duplicatesSkipped ?? 0}</strong> ya conocida(s).
          Los borradores están en Empleos y en la campaña «Ofertas de empleo · LinkedIn».
        </p>
      )}
    </section>
  );
}
