"use client";

import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import AvatarStack from "@/components/AvatarStack";
import { tasks, projects, getClient, getProject, statusLabels, statusColors, priorityColors, type Status } from "@/lib/mock-data";
import { LayoutGrid, List, Plus, Filter, CalendarDays } from "lucide-react";
import clsx from "clsx";

const columns: Status[] = ["todo", "in_progress", "review", "done"];

export default function TareasPage() {
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [projectFilter, setProjectFilter] = useState<string>("all");

  const filtered = tasks.filter((t) => projectFilter === "all" || t.projectId === projectFilter);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Tareas y proyectos"
        description="Gestiona el flujo de trabajo de toda la agencia."
        actions={
          <>
            <div className="flex items-center bg-white border rounded-lg p-0.5">
              <button
                onClick={() => setView("kanban")}
                className={clsx(
                  "px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5",
                  view === "kanban" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-900"
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Tablero
              </button>
              <button
                onClick={() => setView("list")}
                className={clsx(
                  "px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5",
                  view === "list" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-900"
                )}
              >
                <List className="h-3.5 w-3.5" />
                Lista
              </button>
            </div>
            <button className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium">
              <Plus className="h-4 w-4" />
              Nueva tarea
            </button>
          </>
        }
      />

      <div className="flex items-center gap-2 mb-5">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border text-xs">
          <Filter className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-slate-500">Proyecto:</span>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="bg-transparent font-medium focus:outline-none"
          >
            <option value="all">Todos</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {view === "kanban" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {columns.map((col) => {
            const colTasks = filtered.filter((t) => t.status === col);
            return (
              <div key={col} className="bg-slate-100/60 rounded-xl p-3 min-h-[400px]">
                <div className="flex items-center justify-between mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-md border ${statusColors[col]}`}>
                      {statusLabels[col]}
                    </span>
                    <span className="text-xs text-slate-500">{colTasks.length}</span>
                  </div>
                  <button className="text-slate-400 hover:text-slate-700">
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-2">
                  {colTasks.map((t) => {
                    const project = getProject(t.projectId);
                    const client = getClient(t.clientId);
                    return (
                      <div
                        key={t.id}
                        className="bg-white rounded-lg border p-3 hover:shadow-sm transition cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <p className="text-sm font-medium leading-snug">{t.title}</p>
                          <span className={`shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${priorityColors[t.priority]}`}>
                            {t.priority}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
                          <span className={`inline-block h-2 w-2 rounded-full ${project?.color ?? "bg-slate-300"}`} />
                          <span className="truncate">{client?.name}</span>
                        </div>
                        <div className="flex flex-wrap gap-1 mb-3">
                          {t.tags.map((tag) => (
                            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                              #{tag}
                            </span>
                          ))}
                        </div>
                        <div className="flex items-center justify-between">
                          <AvatarStack ids={t.assigneeIds} size={6} />
                          <div className="flex items-center gap-1 text-xs text-slate-500">
                            <CalendarDays className="h-3 w-3" />
                            {new Date(t.dueDate).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-5 py-3">Tarea</th>
                <th className="text-left px-3 py-3">Proyecto</th>
                <th className="text-left px-3 py-3">Estado</th>
                <th className="text-left px-3 py-3">Prioridad</th>
                <th className="text-left px-3 py-3">Asignados</th>
                <th className="text-left px-3 py-3">Entrega</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((t) => {
                const project = getProject(t.projectId);
                const client = getClient(t.clientId);
                return (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="font-medium">{t.title}</div>
                      <div className="text-xs text-slate-500">{client?.name}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${project?.color ?? "bg-slate-300"}`} />
                        <span className="text-xs">{project?.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-xs px-2 py-1 rounded-md border ${statusColors[t.status]}`}>
                        {statusLabels[t.status]}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-xs px-2 py-1 rounded ${priorityColors[t.priority]}`}>
                        {t.priority}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <AvatarStack ids={t.assigneeIds} size={6} />
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      {new Date(t.dueDate).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Proyectos activos</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {projects.map((p) => {
            const client = getClient(p.clientId);
            const projectTasks = tasks.filter((t) => t.projectId === p.id);
            return (
              <div key={p.id} className="bg-white rounded-xl border p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${p.color}`} />
                  <span className="text-xs text-slate-500">{client?.name}</span>
                </div>
                <h3 className="font-semibold">{p.name}</h3>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.description}</p>
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-500">{projectTasks.length} tareas</span>
                    <span className="font-medium">{p.progress}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${p.color}`} style={{ width: `${p.progress}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
