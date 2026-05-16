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
  pausa: "bg-amber-50 text-amber-800 border-amber-200",
  prospecto: "bg-sky-50 text-sky-700 border-sky-200"
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

const STORAGE_KEY = "clientes-view-prefs-v1";

export default function ClientesListClient({
  clients,
  projects,
  tasks
}: {
  clients: UiClient[];
  projects: UiProject[];
  tasks: UiTask[];
}) {
  // Preferencias persistidas en localStorage para que se mantengan al
  // navegar entre páginas.
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("az");
  const [view, setView] = useState<ViewMode>("grid");
  const [prioFilter, setPrioFilter] = useState<"all" | "ALTA" | "NORMAL" | "BAJA">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "activo" | "pausa" | "prospecto">("all");

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
    let arr = [...clients];
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
    switch (sort) {
      case "az":
        arr.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
        break;
      case "za":
        arr.sort((a, b) => b.name.localeCompare(a.name, "es", { sensitivity: "base" }));
        break;
      case "newest":
        arr.sort((a, b) => (b.since ?? "").localeCompare(a.since ?? ""));
        break;
      case "oldest":
        arr.sort((a, b) => (a.since ?? "").localeCompare(b.since ?? ""));
        break;
      case "priority":
        arr.sort((a, b) => {
          const wa = prioridadStyles[a.prioridad ?? "NORMAL"]?.weight ?? 1;
          const wb = prioridadStyles[b.prioridad ?? "NORMAL"]?.weight ?? 1;
          if (wa !== wb) return wa - wb;
          return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
        });
        break;
    }
    return arr;
  }, [clients, search, sort, prioFilter, statusFilter]);

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
          <option value="pausa">En pausa</option>
          <option value="prospecto">Prospecto</option>
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
        Mostrando <strong>{filtered.length}</strong> de {clients.length} clientes
      </p>

      {view === "grid" ? (
        <GridView clients={filtered} projects={projects} tasks={tasks} />
      ) : (
        <ListView clients={filtered} />
      )}
    </div>
  );
}

function GridView({
  clients,
  projects,
  tasks
}: {
  clients: UiClient[];
  projects: UiProject[];
  tasks: UiTask[];
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
                {c.status}
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
              <div>
                <div className="text-slate-500">MRR</div>
                <div className="font-semibold">{c.mrr ? `${c.mrr} €` : "—"}</div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function ListView({ clients }: { clients: UiClient[] }) {
  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Cliente</th>
              <th className="text-left px-3 py-2 font-medium">Sector</th>
              <th className="text-left px-3 py-2 font-medium">Estado</th>
              <th className="text-left px-3 py-2 font-medium">Prioridad</th>
              <th className="text-left px-3 py-2 font-medium">Servicios</th>
              <th className="text-left px-3 py-2 font-medium">Contacto</th>
              <th className="text-right px-3 py-2 font-medium">MRR</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {clients.map((c) => {
              const prio = c.prioridad ?? "NORMAL";
              const pst = prioridadStyles[prio];
              const isHigh = prio === "ALTA";
              return (
                <tr
                  key={c.id}
                  className={
                    "hover:bg-slate-50 transition " +
                    (isHigh ? "bg-rose-50/30" : "")
                  }
                >
                  <td className="px-3 py-2">
                    <Link href={`/clientes/${c.id}`} className="font-medium text-slate-900 hover:text-brand-600">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600 text-xs">{c.industry || "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block text-[11px] px-2 py-0.5 rounded-md border ${statusStyles[c.status]}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
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
                      <span className="ml-1 inline-flex items-center text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-md border bg-indigo-50 text-indigo-800 border-indigo-300">
                        KD
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {Array.isArray(c.servicios) && c.servicios.length > 0
                      ? c.servicios.length + (c.servicios.length === 1 ? " servicio" : " servicios")
                      : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {c.email && <div className="truncate max-w-[180px]">{c.email}</div>}
                    {c.phone && <div className="text-slate-500">{c.phone}</div>}
                    {!c.email && !c.phone && <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">
                    {c.mrr ? `${c.mrr.toLocaleString("es-ES")} €` : <span className="text-slate-400">—</span>}
                  </td>
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
