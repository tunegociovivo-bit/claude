"use client";

/**
 * Bandeja de excepciones (FASE 4b · UI). Consume GET /api/v1/exceptions.
 *
 * SOLO acciones LOCALES seguras: abrir origen (enlace interno), copiar contexto,
 * ocultar localmente (reversible). NO aprueba/resuelve en servidor. Nunca sugiere
 * que una acción se ejecutó. Kill-switch NEXT_PUBLIC_EXCEPTIONS_UI / localStorage
 * 'exceptions-ui'=off → no se monta (fallback). Estados loading/empty/error.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Copy, EyeOff, Eye, RefreshCw } from "lucide-react";
import {
  autonomyForKind,
  severityMeta,
  formatAge,
  safeLink,
  filterItems,
  loadDismissed,
  toggleDismissed,
  SOURCE_LABEL,
  KIND_LABEL,
  type UiFilters
} from "@/lib/exceptions/ui";
import type { ExceptionItem, Severity, ExceptionSource } from "@/lib/exceptions/engine";

type InboxResponse = { items: ExceptionItem[]; summary: Record<string, number> & { total: number }; total: number; capped: boolean };

function uiDisabled(): boolean {
  if (process.env.NEXT_PUBLIC_EXCEPTIONS_UI === "off") return true;
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("exceptions-ui") === "off";
  } catch {
    return false;
  }
}

export default function ExceptionsInbox() {
  const [state, setState] = useState<"loading" | "ready" | "error" | "disabled">("loading");
  const [data, setData] = useState<InboxResponse | null>(null);
  const [filters, setFilters] = useState<UiFilters>({ severity: "all", source: "all", q: "" });
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const store = typeof window !== "undefined" ? window.localStorage : null;

  const load = useCallback(() => {
    setState("loading");
    fetch("/api/v1/exceptions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: InboxResponse) => {
        setData(d);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  useEffect(() => {
    if (uiDisabled()) {
      setState("disabled");
      return;
    }
    setDismissed(loadDismissed(store));
    load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => {
    const items = data?.items ?? [];
    const filtered = filterItems(items, filters);
    return showHidden ? filtered : filtered.filter((it) => !dismissed.includes(it.id));
  }, [data, filters, dismissed, showHidden]);

  const onCopy = useCallback((it: ExceptionItem) => {
    const text = `[${KIND_LABEL[it.kind]}] ${it.title}\nPor qué: ${it.why}\nQué necesita: ${it.needsFromMe}\nEnlace: ${safeLink(it.link) ?? "(interno)"}`;
    try {
      navigator.clipboard?.writeText(text).catch(() => {});
    } catch {
      /* clipboard no disponible */
    }
  }, []);

  const onDismiss = useCallback(
    (id: string) => setDismissed(toggleDismissed(store, id)),
    [store]
  );

  if (state === "disabled") {
    return (
      <p className="text-sm text-slate-500" role="status">
        La bandeja de excepciones está desactivada.
      </p>
    );
  }

  return (
    <section aria-label="Bandeja de excepciones" className="space-y-4">
      {/* Controles */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-slate-500">
          <span className="sr-only">Filtrar por severidad</span>
          <select
            aria-label="Filtrar por severidad"
            value={filters.severity}
            onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value as Severity | "all" }))}
            className="px-2 py-1.5 rounded-lg bg-white border text-xs"
          >
            <option value="all">Toda severidad</option>
            <option value="critical">Crítica</option>
            <option value="high">Alta</option>
            <option value="medium">Media</option>
            <option value="low">Baja</option>
          </select>
        </label>
        <select
          aria-label="Filtrar por origen"
          value={filters.source}
          onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value as ExceptionSource | "all" }))}
          className="px-2 py-1.5 rounded-lg bg-white border text-xs"
        >
          <option value="all">Todo origen</option>
          <option value="ai_draft">Borrador de SONIA</option>
          <option value="ai_run">Ejecución de SONIA</option>
          <option value="invoice">Facturación</option>
          <option value="task">Tarea</option>
        </select>
        <input
          type="search"
          aria-label="Buscar en excepciones"
          placeholder="Buscar…"
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          className="px-2 py-1.5 rounded-lg bg-white border text-xs flex-1 min-w-[8rem]"
        />
        <button
          type="button"
          onClick={() => setShowHidden((v) => !v)}
          className="px-2 py-1.5 rounded-lg border text-xs text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1"
          aria-pressed={showHidden}
        >
          {showHidden ? <Eye aria-hidden className="h-3.5 w-3.5" /> : <EyeOff aria-hidden className="h-3.5 w-3.5" />}
          {showHidden ? "Ocultar ocultas" : "Ver ocultas"}
        </button>
        <button type="button" onClick={load} aria-label="Recargar" className="px-2 py-1.5 rounded-lg border text-xs text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1">
          <RefreshCw aria-hidden className="h-3.5 w-3.5" /> Recargar
        </button>
      </div>

      {/* Capped */}
      {data?.capped && (
        <div className="text-xs px-3 py-2 rounded-lg border bg-amber-50 text-amber-800 border-amber-200" role="status">
          Mostrando una parte: hay más incidencias de las que caben en una carga. Afina los filtros para ver el resto.
        </div>
      )}

      {/* Estados */}
      {state === "loading" && <p className="text-sm text-slate-500" role="status">Cargando incidencias…</p>}
      {state === "error" && (
        <div className="text-sm text-rose-600" role="alert">
          No se pudieron cargar las excepciones.{" "}
          <button type="button" onClick={load} className="underline">Reintentar</button>
        </div>
      )}
      {state === "ready" && visible.length === 0 && (
        <p className="text-sm text-slate-500" role="status">No hay incidencias que requieran tu intervención. 🎉</p>
      )}

      {/* Lista */}
      {state === "ready" && visible.length > 0 && (
        <ul className="space-y-2">
          {visible.map((it) => {
            const sev = severityMeta(it.severity);
            const au = autonomyForKind(it.kind);
            const href = safeLink(it.link);
            const hidden = dismissed.includes(it.id);
            return (
              <li key={it.id} className="bg-white rounded-xl border p-4">
                <div className="flex items-start gap-3">
                  <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${sev.dot}`} aria-hidden />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">{it.title}</h3>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${sev.badge}`}>{sev.label}</span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full border bg-slate-50 text-slate-600 border-slate-200">{SOURCE_LABEL[it.source]}</span>
                      <span
                        className="text-[11px] px-1.5 py-0.5 rounded-full border bg-indigo-50 text-indigo-700 border-indigo-200"
                        aria-label={`Autonomía de SONIA: nivel ${au.level}. ${au.label}${au.requiresApproval ? ", requiere aprobación previa" : ""}`}
                      >
                        {au.level} · {au.label}
                      </span>
                      <span className="text-[11px] text-slate-400">{formatAge(it.ageMs)}</span>
                    </div>
                    <dl className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                      <div>
                        <dt className="text-slate-400">Por qué está aquí</dt>
                        <dd className="text-slate-700">{it.why}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Qué hará SONIA</dt>
                        <dd className="text-slate-700">{it.soniaWillDo ?? "Nada de forma autónoma."}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Qué necesita de ti</dt>
                        <dd className="text-slate-700">{it.needsFromMe}</dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {href ? (
                        <Link href={href} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-slate-700 hover:bg-slate-50">
                          <ExternalLink aria-hidden className="h-3.5 w-3.5" /> Abrir origen
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-400">Sin enlace</span>
                      )}
                      <button type="button" onClick={() => onCopy(it)} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-slate-700 hover:bg-slate-50">
                        <Copy aria-hidden className="h-3.5 w-3.5" /> Copiar contexto
                      </button>
                      <button
                        type="button"
                        onClick={() => onDismiss(it.id)}
                        aria-pressed={hidden}
                        className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-slate-600 hover:bg-slate-50"
                      >
                        <EyeOff aria-hidden className="h-3.5 w-3.5" /> {hidden ? "Mostrar" : "Ocultar"}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
