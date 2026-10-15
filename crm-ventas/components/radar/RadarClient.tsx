"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Car, ListChecks, RefreshCw, Loader2, SlidersHorizontal, KeyRound } from "lucide-react";
import { jsonFetch } from "@/components/inbox/ui";
import PageHeader from "@/components/PageHeader";
import type { Overview } from "./types";
import ResultsView from "./ResultsView";
import SearchesView from "./SearchesView";
import PortalsView from "./PortalsView";
import SettingsView from "./SettingsView";

type Tab = "resultados" | "busquedas" | "portales" | "ajustes";

const TABS: Array<{ id: Tab; label: string; icon: typeof Car }> = [
  { id: "resultados", label: "Resultados", icon: Car },
  { id: "busquedas", label: "Búsquedas", icon: ListChecks },
  { id: "portales", label: "Portales", icon: KeyRound },
  { id: "ajustes", label: "Avisos", icon: SlidersHorizontal },
];

export default function RadarClient() {
  const [tab, setTab] = useState<Tab>("resultados");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runActive, setRunActive] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadOverview = useCallback(async () => {
    const { ok, data } = await jsonFetch<Overview>("/api/v1/radar/overview");
    if (ok) setOverview(data);
    setLoading(false);
  }, []);

  const checkRuns = useCallback(async () => {
    const { ok, data } = await jsonFetch<{ active: boolean }>("/api/v1/radar/runs");
    if (ok) setRunActive(data.active);
    return ok ? data.active : false;
  }, []);

  useEffect(() => {
    void loadOverview();
    void checkRuns();
  }, [loadOverview, checkRuns]);

  // Mientras hay una revisión en curso, refresca el estado cada 8 s.
  useEffect(() => {
    if (!runActive) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = setInterval(async () => {
      const active = await checkRuns();
      if (!active) {
        await loadOverview();
        setNotice({ tone: "ok", text: "Revisión terminada. Mira los resultados." });
      }
    }, 8000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [runActive, checkRuns, loadOverview]);

  async function runNow() {
    setRunning(true);
    setNotice(null);
    const { ok, data } = await jsonFetch<{ error?: string }>("/api/v1/radar/run", { method: "POST" });
    setRunning(false);
    if (ok) {
      setRunActive(true);
      setNotice({ tone: "ok", text: "Revisando los portales… te avisaré cuando termine." });
    } else {
      setNotice({ tone: "error", text: data.error ?? "No se pudo lanzar la revisión." });
    }
  }

  const isAdmin = overview?.isAdmin ?? false;
  const activePortals = overview?.sources.filter((s) => s.enabled && s.hasCredentials).length ?? 0;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-24 pt-4 md:pb-10">
      <PageHeader title="Radar de subastas" description="Revisa cada día los portales de subastas y te avisa de los coches que te interesan." />

      {overview && !overview.browserReady && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          El radar todavía no puede navegar por los portales: falta configurar el navegador en el servidor. Avisa a Negocio Vivo.
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isAdmin && (
          <button
            onClick={() => void runNow()}
            disabled={running || runActive || activePortals === 0}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:opacity-50"
          >
            {running || runActive ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {runActive ? "Revisando…" : "Revisar ahora"}
          </button>
        )}
        {activePortals === 0 && isAdmin && (
          <span className="text-xs text-slate-500">Añade el acceso a algún portal para empezar.</span>
        )}
        {overview && (
          <span className="ml-auto text-xs text-slate-500">
            {activePortals} portal(es) activo(s) · {overview.counts.new} sin ver
          </span>
        )}
      </div>

      {notice && (
        <div className={clsx("mt-3 rounded-xl border p-3 text-sm", notice.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700")}>
          {notice.text}
        </div>
      )}

      {/* Pestañas */}
      <div className="mt-4 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const count = t.id === "resultados" ? overview?.counts.new : t.id === "busquedas" ? overview?.searches.length : undefined;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                "flex flex-1 min-w-[84px] items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition",
                tab === t.id ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
              )}
            >
              <Icon size={16} />
              <span>{t.label}</span>
              {typeof count === "number" && count > 0 && (
                <span className={clsx("rounded-full px-1.5 text-[11px] font-bold", tab === t.id ? "bg-brand-100 text-brand-700" : "bg-slate-200 text-slate-600")}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        {loading || !overview ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="animate-spin" />
          </div>
        ) : tab === "resultados" ? (
          <ResultsView searches={overview.searches} onChanged={loadOverview} />
        ) : tab === "busquedas" ? (
          <SearchesView overview={overview} reload={loadOverview} />
        ) : tab === "portales" ? (
          <PortalsView overview={overview} reload={loadOverview} onRunStarted={() => setRunActive(true)} />
        ) : (
          <SettingsView overview={overview} reload={loadOverview} />
        )}
      </div>
    </div>
  );
}
