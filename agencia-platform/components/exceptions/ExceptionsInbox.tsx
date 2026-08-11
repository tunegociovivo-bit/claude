"use client";

/**
 * Bandeja de excepciones (Slice 2a · UI con valor). Consume GET /api/v1/exceptions.
 *
 * Vista por defecto = trabajo ACTUAL y accionable, organizado en secciones
 * ejecutivas (Prioridades / Hoy / Cobros y SLA / Clientes en riesgo / Hecho por
 * SONIA). El histórico (>ventana) se resume y se abre bajo demanda (view=archive),
 * nunca inunda la vista principal.
 *
 * SOLO acciones LOCALES seguras (abrir origen, copiar contexto, ocultar local
 * reversible). No aprueba/resuelve en servidor (eso llega en Slice 2b). Kill-switch
 * NEXT_PUBLIC_EXCEPTIONS_UI / localStorage 'exceptions-ui'=off → fallback total.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Copy, EyeOff, Eye, RefreshCw, CheckCircle2, Archive } from "lucide-react";
import {
  autonomyForKind,
  severityMeta,
  formatAge,
  safeLink,
  filterItems,
  loadDismissed,
  toggleDismissed,
  dismissKey,
  SOURCE_LABEL,
  KIND_LABEL,
  type UiFilters
} from "@/lib/exceptions/ui";
import type { ExceptionItem, Severity, ExceptionSource } from "@/lib/exceptions/engine";

type ClientRisk = { clientId: string; clientName: string | null; count: number; maxSeverity: Severity; items: ExceptionItem[] };
type Sections = { today: ExceptionItem[]; blockers: ExceptionItem[]; billingSla: ExceptionItem[]; clientsAtRisk: ClientRisk[] };
type DoneItem = { id: string; taskId: string; title: string; summary: string | null; at: string; ageMs: number; link: string };
type Cluster = { key: string; count: number; label: string; sampleIds: string[]; clientName: string | null };
type HistoricalSummary = { source: ExceptionSource; count: number; label: string };
type InboxResponse = {
  items: ExceptionItem[];
  summary: Record<string, number> & { total: number };
  total: number;
  capped: boolean;
  view: "active" | "archive";
  activeWindowDays: number;
  actionsEnabled: boolean;
  hiddenIds: string[];
  hiddenCount: number;
  sections: Sections | null;
  done: DoneItem[];
  historical: { total: number; bySource: HistoricalSummary[] };
  clusters: Cluster[];
};

type Tab = "priorities" | "today" | "blockers" | "billing" | "clients" | "done" | "archive";

const TABS: { key: Tab; label: string }[] = [
  { key: "priorities", label: "Prioridades" },
  { key: "today", label: "Hoy" },
  { key: "blockers", label: "Bloqueos reales" },
  { key: "billing", label: "Cobros y SLA" },
  { key: "clients", label: "Clientes en riesgo" },
  { key: "done", label: "Hecho por SONIA" },
  { key: "archive", label: "Histórico" }
];

// Tabs cuyo contenido es una lista de ExceptionItem (mismo renderizador de tarjeta).
const ITEM_TABS: Tab[] = ["priorities", "today", "blockers", "billing", "archive"];

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
  const [archive, setArchive] = useState<InboxResponse | null>(null);
  const [archiveState, setArchiveState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [tab, setTab] = useState<Tab>("priorities");
  const [filters, setFilters] = useState<UiFilters>({ severity: "all", source: "all", q: "" });
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [actionError, setActionError] = useState(false);
  const store = typeof window !== "undefined" ? window.localStorage : null;

  const qs = useCallback((view: "active" | "archive", f: UiFilters, includeHidden?: boolean) => {
    const sp = new URLSearchParams();
    if (view === "archive") sp.set("view", "archive");
    if (f.severity && f.severity !== "all") sp.set("severity", f.severity);
    if (f.source && f.source !== "all") sp.set("source", f.source);
    if (includeHidden) sp.set("includeHidden", "1");
    const s = sp.toString();
    return s ? `?${s}` : "";
  }, []);

  const load = useCallback(
    (f: UiFilters, signal?: AbortSignal, includeHidden?: boolean) => {
      setState("loading");
      fetch(`/api/v1/exceptions${qs("active", f, includeHidden)}`, { cache: "no-store", signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: InboxResponse) => {
          setData(d);
          setState("ready");
        })
        .catch((e) => {
          if (e?.name !== "AbortError") setState("error");
        });
    },
    [qs]
  );

  const loadArchive = useCallback(
    (f: UiFilters) => {
      setArchiveState("loading");
      fetch(`/api/v1/exceptions${qs("archive", f)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: InboxResponse) => {
          setArchive(d);
          setArchiveState("ready");
        })
        .catch(() => setArchiveState("error"));
    },
    [qs]
  );

  useEffect(() => {
    if (uiDisabled()) {
      setState("disabled");
      return;
    }
    setDismissed(loadDismissed(store));
    const ac = new AbortController();
    load(filters, ac.signal, showHidden);
    // Al cambiar filtros, el histórico cargado queda obsoleto.
    setArchive(null);
    setArchiveState("idle");
    return () => ac.abort();
  }, [filters.severity, filters.source, load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab === "archive" && archiveState === "idle") loadArchive(filters);
  }, [tab, archiveState, loadArchive, filters]);

  // Modo servidor (persistencia activa): al alternar "ver ocultas" se re-consulta
  // con includeHidden (las ocultas viven en el servidor, no en el cliente).
  useEffect(() => {
    if (data?.actionsEnabled && !uiDisabled()) load(filters, undefined, showHidden);
  }, [showHidden]); // eslint-disable-line react-hooks/exhaustive-deps

  const serverMode = !!data?.actionsEnabled;

  const isHidden = useCallback(
    (it: ExceptionItem) => (serverMode ? (data?.hiddenIds?.includes(it.id) ?? false) : dismissed.includes(dismissKey(it))),
    [serverMode, data, dismissed]
  );

  const applyLocal = useCallback(
    (items: ExceptionItem[]) => {
      const q = (filters.q ?? "").trim();
      const searched = q ? filterItems(items, { q }) : items;
      // En modo servidor las ocultas ya las gestiona el backend (includeHidden).
      if (serverMode) return searched;
      return showHidden ? searched : searched.filter((it) => !dismissed.includes(dismissKey(it)));
    },
    [filters.q, showHidden, dismissed, serverMode]
  );

  const onCopy = useCallback((it: ExceptionItem) => {
    const text = `[${KIND_LABEL[it.kind]}] ${it.title}\nPor qué: ${it.why}\nQué necesita: ${it.needsFromMe}\nEnlace: ${safeLink(it.link) ?? "(interno)"}`;
    try {
      navigator.clipboard?.writeText(text).catch(() => {});
    } catch {
      /* clipboard no disponible */
    }
  }, []);

  // Ocultar/mostrar: server-side (idempotente, auditado) si la persistencia está
  // activa; si no, localStorage (fallback, comportamiento previo).
  const onToggleHide = useCallback(
    (it: ExceptionItem, hidden: boolean) => {
      if (serverMode) {
        setActionError(false);
        const body = hidden
          ? { revoke: true, exceptionId: it.id, action: "archive" }
          : { exceptionId: it.id, dedupeKey: it.dedupeKey, source: it.source, kind: it.kind, action: "archive", severity: it.severity };
        fetch("/api/v1/exceptions/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
          .then((r) => {
            if (r.ok) load(filters, undefined, showHidden);
            else setActionError(true);
          })
          .catch(() => setActionError(true));
      } else {
        setDismissed(toggleDismissed(store, dismissKey(it)));
      }
    },
    [serverMode, filters, showHidden, store, load]
  );

  const hiddenCount = useMemo(
    () => (serverMode ? data?.hiddenCount ?? 0 : (data?.items ?? []).filter(isHidden).length),
    [serverMode, data, isHidden]
  );

  if (state === "disabled") {
    return (
      <p className="text-sm text-slate-500" role="status">
        La bandeja de excepciones está desactivada.
      </p>
    );
  }

  const sections = data?.sections;
  const currentItems: ExceptionItem[] =
    tab === "priorities"
      ? data?.items ?? []
      : tab === "today"
        ? sections?.today ?? []
        : tab === "blockers"
          ? sections?.blockers ?? []
          : tab === "billing"
            ? sections?.billingSla ?? []
            : tab === "archive"
              ? archive?.items ?? []
              : [];
  const visible = applyLocal(currentItems);
  // Ocultas EN LA PESTAÑA ACTUAL (no solo en Prioridades) → estados honestos.
  const hiddenHere = currentItems.filter(isHidden).length;
  // ¿La lista de prioridades está recortada por `limit`/cap? (transparencia)
  const prioritiesTruncated = tab === "priorities" && !!data && (data.capped || data.total > data.items.length);

  return (
    <section aria-label="Bandeja de excepciones" className="space-y-4">
      <h2 className="sr-only">Incidencias que requieren tu intervención</h2>

      {/* Tabs */}
      <div role="tablist" aria-label="Secciones" className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => {
          const count = tabCount(t.key, data, archive);
          return (
            <button
              key={t.key}
              role="tab"
              id={`exc-tab-${t.key}`}
              aria-controls="exc-tabpanel"
              aria-selected={tab === t.key}
              tabIndex={tab === t.key ? 0 : -1}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-xs rounded-t-lg border-b-2 ${tab === t.key ? "border-indigo-500 text-indigo-700 font-semibold" : "border-transparent text-slate-500 hover:text-slate-700"}`}
            >
              {t.label}
              {count != null && <span className="ml-1 text-[10px] text-slate-400">({count})</span>}
            </button>
          );
        })}
      </div>

      {/* Controles */}
      <div className="flex flex-wrap items-center gap-2">
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
          {showHidden ? "Ocultar ocultas" : `Ver ocultas${hiddenCount ? ` (${hiddenCount})` : ""}`}
        </button>
        <button type="button" onClick={() => load(filters)} aria-label="Recargar" className="px-2 py-1.5 rounded-lg border text-xs text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1">
          <RefreshCw aria-hidden className="h-3.5 w-3.5" /> Recargar
        </button>
      </div>

      {actionError && (
        <div className="text-xs px-3 py-2 rounded-lg border bg-rose-50 text-rose-700 border-rose-200" role="alert">
          No se pudo guardar la acción. Inténtalo de nuevo.
        </div>
      )}

      {/* Resumen histórico (banner en vistas activas) */}
      {tab !== "archive" && data?.historical && data.historical.total > 0 && (
        <div className="text-xs px-3 py-2 rounded-lg border bg-slate-50 text-slate-600 flex flex-wrap items-center gap-2" role="status">
          <Archive aria-hidden className="h-3.5 w-3.5 text-slate-400" />
          <span>
            {data.historical.bySource.map((h) => h.label).join(" · ") || `${data.historical.total} incidencias históricas`}. No se muestran aquí para no tapar el trabajo actual.
          </span>
          <button type="button" onClick={() => setTab("archive")} className="underline text-slate-700">
            Ver histórico
          </button>
        </div>
      )}

      {/* Transparencia: la lista de prioridades está recortada */}
      {prioritiesTruncated && data && (
        <div className="text-xs px-3 py-2 rounded-lg border bg-amber-50 text-amber-800 border-amber-200" role="status">
          Mostrando las {data.items.length} incidencias más prioritarias de {data.total}. Afina los filtros (severidad/origen) para ver el resto.
        </div>
      )}

      {/* Panel de la pestaña activa */}
      <div role="tabpanel" id="exc-tabpanel" aria-labelledby={`exc-tab-${tab}`} tabIndex={0}>
      {/* Estados */}
      {state === "loading" && (
        <p className="text-sm text-slate-500" role="status">
          Cargando incidencias…
        </p>
      )}
      {state === "error" && (
        <div className="text-sm text-rose-600" role="alert">
          No se pudieron cargar las excepciones.{" "}
          <button type="button" onClick={() => load(filters)} className="underline">
            Reintentar
          </button>
        </div>
      )}

      {state === "ready" && (
        <>
          {/* Clientes en riesgo */}
          {tab === "clients" &&
            (sections?.clientsAtRisk?.length ? (
              <ul className="space-y-2">
                {sections.clientsAtRisk.map((r) => {
                  const sev = severityMeta(r.maxSeverity);
                  return (
                    <li key={r.clientId} className="bg-white rounded-xl border p-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`h-2.5 w-2.5 rounded-full ${sev.dot}`} aria-hidden />
                        <span className="text-sm font-semibold text-slate-900">{r.clientName ?? "Cliente"}</span>
                        <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${sev.badge}`}>{sev.label}</span>
                        <span className="text-[11px] text-slate-500">
                          {r.count} incidencia{r.count === 1 ? "" : "s"}
                        </span>
                      </div>
                      <ul className="mt-2 space-y-1">
                        {r.items.slice(0, 5).map((it) => {
                          const href = safeLink(it.link);
                          return (
                            <li key={it.id} className="text-xs text-slate-600 flex items-center gap-2">
                              <span className="text-slate-400">·</span>
                              {href ? (
                                <Link href={href} className="hover:underline">
                                  {it.title}
                                </Link>
                              ) : (
                                <span>{it.title}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-slate-500" role="status">
                Ningún cliente en riesgo ahora mismo. 🎉
              </p>
            ))}

          {/* Hecho por SONIA */}
          {tab === "done" &&
            (data?.done?.length ? (
              <ul className="space-y-2">
                {data.done.map((d) => {
                  const href = safeLink(d.link);
                  return (
                    <li key={d.id} className="bg-white rounded-xl border p-3 flex items-start gap-2">
                      <CheckCircle2 aria-hidden className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm text-slate-800">
                          {href ? (
                            <Link href={href} className="hover:underline">
                              {d.title}
                            </Link>
                          ) : (
                            d.title
                          )}
                        </div>
                        {d.summary && <div className="text-xs text-slate-500 truncate">{d.summary}</div>}
                        <div className="text-[11px] text-slate-400">{formatAge(d.ageMs)}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-slate-500" role="status">
                SONIA no ha completado tareas en el periodo reciente.
              </p>
            ))}

          {/* Histórico: clusters + lista */}
          {tab === "archive" && (
            <>
              {archiveState === "loading" && (
                <p className="text-sm text-slate-500" role="status">
                  Cargando histórico…
                </p>
              )}
              {archiveState === "error" && (
                <div className="text-sm text-rose-600" role="alert">
                  No se pudo cargar el histórico.{" "}
                  <button type="button" onClick={() => loadArchive(filters)} className="underline">
                    Reintentar
                  </button>
                </div>
              )}
              {archiveState === "ready" && (
                <>
                  {/* Total real (de los count() de la vista activa) + aviso de muestra */}
                  {data?.historical && data.historical.total > 0 && (
                    <p className="text-xs text-slate-500 mb-2" role="status">
                      Histórico total: {data.historical.total} incidencia(s) vencidas hace más de {archive?.activeWindowDays ?? data.activeWindowDays} días.
                      {archive?.capped ? " Se muestra una muestra (hay más de las que caben en una carga)." : ""}
                    </p>
                  )}
                  {archive?.clusters?.length ? (
                    <ul className="space-y-1.5 mb-3">
                      {archive.clusters.slice(0, 12).map((c) => (
                        <li key={c.key} className="text-xs px-3 py-2 rounded-lg border bg-slate-50 text-slate-600 flex items-center gap-2">
                          <Archive aria-hidden className="h-3.5 w-3.5 text-slate-400" />
                          <span>
                            {archive?.capped ? "≥ " : ""}
                            {c.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
            </>
          )}

          {/* Lista de ítems (priorities / today / blockers / billing / archive) */}
          {ITEM_TABS.includes(tab) &&
            (visible.length > 0 ? (
              <ul className="space-y-2">
                {visible.map((it) => (
                  <ExceptionCard key={it.id} it={it} hidden={isHidden(it)} onCopy={onCopy} onToggleHide={onToggleHide} />
                ))}
              </ul>
            ) : tab !== "archive" || archiveState === "ready" ? (
              <p className="text-sm text-slate-500" role="status">
                {hiddenHere > 0
                  ? `No hay incidencias visibles aquí, pero tienes ${hiddenHere} oculta(s). Pulsa "Ver ocultas".`
                  : "No hay incidencias que requieran tu intervención aquí. 🎉"}
              </p>
            ) : null)}
        </>
      )}
      </div>
    </section>
  );
}

function tabCount(key: Tab, data: InboxResponse | null, archive: InboxResponse | null): number | null {
  if (!data) return null;
  switch (key) {
    case "priorities":
      return data.total;
    case "today":
      return data.sections?.today.length ?? 0;
    case "blockers":
      return data.sections?.blockers.length ?? 0;
    case "billing":
      return data.sections?.billingSla.length ?? 0;
    case "clients":
      return data.sections?.clientsAtRisk.length ?? 0;
    case "done":
      return data.done?.length ?? 0;
    case "archive":
      // El total REAL del histórico viene de los count() de la vista activa;
      // el `archive.total` es solo la muestra cargada (≤cap) → no lo usamos aquí.
      return data.historical?.total ?? archive?.total ?? null;
  }
}

function ExceptionCard({ it, hidden, onCopy, onToggleHide }: { it: ExceptionItem; hidden: boolean; onCopy: (it: ExceptionItem) => void; onToggleHide: (it: ExceptionItem, hidden: boolean) => void }) {
  const sev = severityMeta(it.severity);
  const au = autonomyForKind(it.kind);
  const href = safeLink(it.link);
  return (
    <li className="bg-white rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${sev.dot}`} aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{it.title}</h3>
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${sev.badge}`}>{sev.label}</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded-full border bg-slate-50 text-slate-600 border-slate-200">{SOURCE_LABEL[it.source]}</span>
            {it.amountBand && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">Importe {it.amountBand}</span>
            )}
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
              <dd className="text-slate-700">{it.soniaWillDo ?? "Sin acción autónoma por política."}</dd>
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
              onClick={() => onToggleHide(it, hidden)}
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
}
