"use client";

import Link from "next/link";
import { useMemo, useState, useEffect } from "react";
import type { UiClient, UiProject, UiTask } from "@/lib/db/queries";
import {
  Mail,
  Phone,
  Building2,
  ArrowUpRight,
  Search,
  LayoutGrid,
  List as ListIcon,
  X
} from "lucide-react";

const statusStyles: Record<string, string> = {
  activo: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pausa: "bg-slate-100 text-slate-600 border-slate-300"
};

// Label visible para cada status — "pausa" se muestra como "no activo".
const statusLabels: Record<string, string> = {
  activo: "activo",
  pausa: "no activo"
};

const prioridadStyles: Record<string, { card: string; badge: string; dot: string; label: string; weight: number }> = {
  ALTA: {
    card: "border-l-4 border-l-rose-500 bg-rose-50/30",
    badge: "bg-rose-100 text-rose-800 border-rose-400",
    dot: "bg-rose-500 animate-pulse",
    label: "ALTA",
    weight: 0
  },
  NORMAL: {
    card: "",
    badge: "bg-sky-50 text-sky-800 border-sky-300",
    dot: "bg-sky-500",
    label: "NORMAL",
    weight: 1
  },
  BAJA: {
    card: "",
    badge: "bg-emerald-50 text-emerald-800 border-emerald-300",
    dot: "bg-emerald-500",
    label: "BAJA",
    weight: 2
  }
};

type SortKey = "az" | "za" | "newest" | "oldest" | "priority";
type ViewMode = "grid" | "list";

const SORT_LABEL: Record<SortKey, string> = {
  az: "A → Z",
  za: "Z → A",
  newest: "Más recientes",
  oldest: "Más antiguos",
  priority: "Prioridad (ALTA primero)"
};

const STORAGE_KEY = "clientes-view-prefs-v2";

export default function ClientesListClient({
  clients: initialClients,
  projects,
  tasks,
  isAdmin = false
}: {
  clients: UiClient[];
  projects: UiProject[];
  tasks: UiTask[];
  isAdmin?: boolean;
}) {
  // Preferencias persistidas en localStorage para que se mantengan al
  // navegar entre páginas. Default = vista lista (mejor para >50 clientes).
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("az");
  const [view, setView] = useState<ViewMode>("list");
  const [prioFilter, setPrioFilter] = useState<"all" | "ALTA" | "NORMAL" | "BAJA">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "activo" | "pausa">("all");

  // Estado local de clientes para que las ediciones inline se reflejen
  // sin re-fetch del servidor.
  const [data, setData] = useState<UiClient[]>(initialClients);
  useEffect(() => {
    setData(initialClients);
  }, [initialClients]);

  function patchClientLocal(id: string, partial: Partial<UiClient>) {
    setData((arr) => arr.map((c) => (c.id === id ? { ...c, ...partial } : c)));
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p.sort) setSort(p.sort);
      if (p.view) setView(p.view);
      if (p.prioFilter) setPrioFilter(p.prioFilter);
      if (p.statusFilter) setStatusFilter(p.statusFilter);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ sort, view, prioFilter, statusFilter }));
    } catch {}
  }, [sort, view, prioFilter, statusFilter]);

  const filtered = useMemo(() => {
    let arr = [...data];
    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter((c) => {
        const hay = [
          c.name,
          c.industry,
          c.contactName,
          c.email,
          c.phone,
          c.notes
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    if (prioFilter !== "all") {
      arr = arr.filter((c) => (c.prioridad ?? "NORMAL") === prioFilter);
    }
    if (statusFilter !== "all") {
      arr = arr.filter((c) => c.status === statusFilter);
    }
    // Comparador base según el sort elegido.
    const baseCmp = (a: UiClient, b: UiClient): number => {
      switch (sort) {
        case "az":
          return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
        case "za":
          return b.name.localeCompare(a.name, "es", { sensitivity: "base" });
        case "newest":
          return (b.since ?? "").localeCompare(a.since ?? "");
        case "oldest":
          return (a.since ?? "").localeCompare(b.since ?? "");
        case "priority": {
          const wa = prioridadStyles[a.prioridad ?? "NORMAL"]?.weight ?? 1;
          const wb = prioridadStyles[b.prioridad ?? "NORMAL"]?.weight ?? 1;
          if (wa !== wb) return wa - wb;
          return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
        }
      }
    };
    // Wrap: los "no activos" (pausa) SIEMPRE al final, independientemente
    // del sort. Dentro de cada grupo (activos / no activos) aplica el
    // comparador base.
    arr.sort((a, b) => {
      const ap = a.status === "pausa" ? 1 : 0;
      const bp = b.status === "pausa" ? 1 : 0;
      if (ap !== bp) return ap - bp;
      return baseCmp(a, b);
    });
    return arr;
  }, [data, search, sort, prioFilter, statusFilter]);

  return (
    <div className="space-y-4">
      {/* Toolbar: buscador + filtros + vista */}
      <div className="bg-white rounded-xl border p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, sector, email…"
            className="w-full pl-8 pr-8 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              title="Limpiar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <option key={k} value={k}>{SORT_LABEL[k]}</option>
          ))}
        </select>

        <select
          value={prioFilter}
          onChange={(e) => setPrioFilter(e.target.value as any)}
          className="px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">Prioridad: todas</option>
          <option value="ALTA">🔴 ALTA</option>
          <option value="NORMAL">🔵 NORMAL</option>
          <option value="BAJA">🟢 BAJA</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">Estado: todos</option>
          <option value="activo">Activo</option>
          <option value="pausa">No activo</option>
        </select>

        <div className="flex items-center rounded-lg border bg-white">
          <button
            onClick={() => setView("grid")}
            title="Vista en cuadrícula"
            className={
              "px-2.5 py-2 rounded-l-lg " +
              (view === "grid" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-900")
            }
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setView("list")}
            title="Vista en filas"
            className={
              "px-2.5 py-2 rounded-r-lg border-l " +
              (view === "list" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-900")
            }
          >
            <ListIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Mostrando <strong>{filtered.length}</strong> de {data.length} clientes
      </p>

      {view === "grid" ? (
        <GridView clients={filtered} projects={projects} tasks={tasks} isAdmin={isAdmin} />
      ) : (
        <ListView clients={filtered} onLocalUpdate={patchClientLocal} isAdmin={isAdmin} />
      )}
    </div>
  );
}

// PATCH inline en /api/v1/clients/[id]. Devuelve true si OK.
async function patchClientRemote(id: string, payload: Record<string, any>): Promise<boolean> {
  try {
    const r = await fetch(`/api/v1/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return r.ok;
  } catch {
    return false;
  }
}

function GridView({
  clients,
  projects,
  tasks,
  isAdmin
}: {
  clients: UiClient[];
  projects: UiProject[];
  tasks: UiTask[];
  isAdmin: boolean;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {clients.map((c) => {
        const clientProjects = projects.filter((p) => p.clientId === c.id);
        const clientTasks = tasks.filter((t) => t.clientId === c.id && t.status !== "done");
        const prio = c.prioridad ?? "NORMAL";
        const pst = prioridadStyles[prio];
        return (
          <Link
            key={c.id}
            href={`/clientes/${c.id}`}
            className={
              "bg-white rounded-xl border p-5 hover:shadow-sm hover:border-brand-200 transition group " +
              pst.card
            }
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-lg bg-slate-100 grid place-items-center text-slate-500">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold leading-tight">{c.name}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{c.industry}</p>
                </div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-slate-300 group-hover:text-brand-600" />
            </div>

            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <span className={`inline-block text-xs px-2 py-0.5 rounded-md border ${statusStyles[c.status]}`}>
                {statusLabels[c.status] ?? c.status}
              </span>
              <span
                className={
                  "inline-flex items-center gap-1 text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-md border " +
                  pst.badge
                }
              >
                <span className={"h-1.5 w-1.5 rounded-full " + pst.dot} />
                {pst.label}
              </span>
              {c.kitDigital && (
                <span className="inline-flex items-center text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-md border bg-indigo-50 text-indigo-800 border-indigo-300">
                  KIT DIGITAL
                </span>
              )}
            </div>

            <div className="space-y-1.5 text-xs text-slate-600">
              <div className="flex items-center gap-2 truncate">
                <Mail className="h-3.5 w-3.5 text-slate-400" />
                {c.email || <span className="text-slate-400">—</span>}
              </div>
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-slate-400" />
                {c.phone || <span className="text-slate-400">—</span>}
              </div>
            </div>

            <div className="border-t mt-4 pt-3 flex items-center justify-between text-xs">
              <div>
                <div className="text-slate-500">Proyectos</div>
                <div className="font-semibold">{clientProjects.length}</div>
              </div>
              <div>
                <div className="text-slate-500">Tareas abiertas</div>
                <div className="font-semibold">{clientTasks.length}</div>
              </div>
              {isAdmin && (
                <div>
                  <div className="text-slate-500">MRR</div>
                  <div className="font-semibold">{c.mrr ? `${c.mrr} €` : "—"}</div>
                </div>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function ListView({
  clients,
  onLocalUpdate,
  isAdmin
}: {
  clients: UiClient[];
  onLocalUpdate: (id: string, partial: Partial<UiClient>) => void;
  isAdmin: boolean;
}) {
  // Mapeo estado UI → enum backend. "no activo" UI → PAUSED en BD.
  const UI_TO_BACKEND_STATUS: Record<string, "ACTIVE" | "PAUSED"> = {
    activo: "ACTIVE",
    pausa: "PAUSED"
  };
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  async function updatePrio(c: UiClient, prio: "ALTA" | "NORMAL" | "BAJA") {
    onLocalUpdate(c.id, { prioridad: prio });
    setSaving((s) => ({ ...s, [c.id]: true }));
    const ok = await patchClientRemote(c.id, { prioridad: prio });
    setSaving((s) => ({ ...s, [c.id]: false }));
    if (!ok) {
      onLocalUpdate(c.id, { prioridad: c.prioridad });
      alert("No se pudo guardar la prioridad");
    }
  }

  async function updateStatus(c: UiClient, statusUi: "activo" | "pausa") {
    onLocalUpdate(c.id, { status: statusUi });
    setSaving((s) => ({ ...s, [c.id]: true }));
    const ok = await patchClientRemote(c.id, { status: UI_TO_BACKEND_STATUS[statusUi] });
    setSaving((s) => ({ ...s, [c.id]: false }));
    if (!ok) {
      onLocalUpdate(c.id, { status: c.status });
      alert("No se pudo guardar el estado");
    }
  }

  async function updateKit(c: UiClient, kit: boolean) {
    onLocalUpdate(c.id, { kitDigital: kit });
    setSaving((s) => ({ ...s, [c.id]: true }));
    const ok = await patchClientRemote(c.id, { kitDigital: kit });
    setSaving((s) => ({ ...s, [c.id]: false }));
    if (!ok) {
      onLocalUpdate(c.id, { kitDigital: c.kitDigital });
      alert("No se pudo guardar KIT DIGITAL");
    }
  }

  return (
    <div className="bg-white rounded-xl border">
      <div className="overflow-visible">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Cliente</th>
              <th className="text-left px-3 py-2 font-medium">Estado</th>
              <th className="text-left px-3 py-2 font-medium">Prioridad</th>
              <th className="text-left px-3 py-2 font-medium">KD</th>
              <th className="text-left px-3 py-2 font-medium">Servicios</th>
              {isAdmin && <th className="text-right px-3 py-2 font-medium">MRR</th>}
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {clients.map((c) => {
              const prio = c.prioridad ?? "NORMAL";
              const pst = prioridadStyles[prio];
              const isHigh = prio === "ALTA";
              const isInactive = c.status === "pausa";
              const isSaving = !!saving[c.id];
              return (
                <tr
                  key={c.id}
                  className={
                    "hover:bg-slate-50 transition " +
                    (isHigh ? "bg-rose-50/30 " : "") +
                    (isInactive ? "opacity-60 " : "")
                  }
                >
                  <td className="px-3 py-2">
                    <Link href={`/clientes/${c.id}`} className="font-medium text-slate-900 hover:text-brand-600">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={c.status}
                      onChange={(e) => updateStatus(c, e.target.value as any)}
                      disabled={isSaving}
                      className={
                        "text-[11px] px-1.5 py-0.5 rounded-md border focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50 " +
                        statusStyles[c.status]
                      }
                    >
                      <option value="activo">activo</option>
                      <option value="pausa">no activo</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <div className="relative inline-block">
                      <select
                        value={prio}
                        onChange={(e) => updatePrio(c, e.target.value as any)}
                        disabled={isSaving}
                        className={
                          "text-[10px] font-bold tracking-wide pl-5 pr-1.5 py-0.5 rounded-md border appearance-none focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50 " +
                          pst.badge
                        }
                      >
                        <option value="ALTA">ALTA</option>
                        <option value="NORMAL">NORMAL</option>
                        <option value="BAJA">BAJA</option>
                      </select>
                      <span
                        className={"absolute left-1.5 top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full pointer-events-none " + pst.dot}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={!!c.kitDigital}
                      onChange={(e) => updateKit(c, e.target.checked)}
                      disabled={isSaving}
                      className="accent-indigo-600 h-3.5 w-3.5"
                      title="KIT DIGITAL"
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {Array.isArray(c.servicios) && c.servicios.length > 0 ? (
                      <span className="relative inline-block group/svc" title={c.servicios.join(", ")}>
                        <span className="cursor-default border-b border-dotted border-slate-300">
                          {c.servicios.length}
                          {c.servicios.length === 1 ? " servicio" : " servicios"}
                        </span>
                        <span
                          role="tooltip"
                          className="pointer-events-none invisible group-hover/svc:visible opacity-0 group-hover/svc:opacity-100 transition-opacity absolute z-10 left-0 top-full mt-1 min-w-[160px] max-w-[260px] rounded-md border border-slate-200 bg-white shadow-lg p-2 text-[11px] text-slate-700"
                        >
                          <div className="font-semibold text-slate-500 uppercase tracking-wide text-[9px] mb-1">
                            Servicios activos
                          </div>
                          <ul className="space-y-0.5">
                            {c.servicios.map((s) => (
                              <li key={s} className="flex items-start gap-1.5">
                                <span className="text-brand-500 leading-none mt-0.5">•</span>
                                <span>{s}</span>
                              </li>
                            ))}
                          </ul>
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-3 py-2 text-right tabular-nums text-xs">
                      {c.mrr ? `${c.mrr.toLocaleString("es-ES")} €` : <span className="text-slate-400">—</span>}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/clientes/${c.id}`}
                      className="inline-flex items-center text-brand-600 hover:text-brand-800 text-xs font-medium"
                    >
                      Abrir →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
