"use client";

import { useState } from "react";
import { Trash2, ChevronsRight, FolderInput, Users, X, Loader2 } from "lucide-react";
import type { UiProject, UiMember } from "@/lib/db/queries";

type KanbanColumn = { id: string; label: string; color: string; order: number };

type BulkAction = "delete" | "move_status" | "move_project" | "assign";

export default function BulkActionBar({
  count,
  selectedIds,
  projects,
  team,
  columns,
  onDone,
  onCancel
}: {
  count: number;
  selectedIds: string[];
  projects: UiProject[];
  team: UiMember[];
  columns: KanbanColumn[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [action, setAction] = useState<BulkAction>("move_status");
  const [statusTarget, setStatusTarget] = useState<string>(columns[0]?.id ?? "TODO");
  const [projectTarget, setProjectTarget] = useState<string>(projects[0]?.id ?? "");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [assignMode, setAssignMode] = useState<"replace" | "add">("replace");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleAssignee(id: string) {
    setAssigneeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function run() {
    if (running) return;
    setError(null);
    setRunning(true);
    try {
      let params: Record<string, any> = {};
      if (action === "move_status") params = { status: statusTarget };
      if (action === "move_project") {
        if (!projectTarget) throw new Error("Selecciona un proyecto destino");
        params = { projectId: projectTarget };
      }
      if (action === "assign") params = { assigneeIds, mode: assignMode };

      if (action === "delete") {
        if (!confirm(`¿Eliminar ${count} tareas? No se puede deshacer.`)) {
          setRunning(false);
          return;
        }
      }

      const r = await fetch("/api/v1/tasks/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, action, params })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `Error ${r.status}`);
      }
      onDone();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fixed bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white rounded-xl sm:rounded-2xl shadow-2xl border border-slate-700 p-2 sm:p-3 flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 max-w-3xl w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)]">
      <div className="text-sm font-semibold tabular-nums px-2 shrink-0">
        {count} {count === 1 ? "tarea" : "tareas"}
      </div>

      <div className="flex items-center gap-2 flex-1 min-w-0">
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as BulkAction)}
          className="bg-slate-800 text-white text-sm px-2.5 py-1.5 rounded-md border border-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="move_status">Mover a columna…</option>
          <option value="move_project">Mover a proyecto…</option>
          <option value="assign">Asignar a…</option>
          <option value="delete">Eliminar</option>
        </select>

        {action === "move_status" && (
          <select
            value={statusTarget}
            onChange={(e) => setStatusTarget(e.target.value)}
            className="bg-slate-800 text-white text-sm px-2.5 py-1.5 rounded-md border border-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {columns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        )}

        {action === "move_project" && (
          <select
            value={projectTarget}
            onChange={(e) => setProjectTarget(e.target.value)}
            className="bg-slate-800 text-white text-sm px-2.5 py-1.5 rounded-md border border-slate-600 max-w-[200px] truncate focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}

        {action === "assign" && (
          <>
            <select
              value={assignMode}
              onChange={(e) => setAssignMode(e.target.value as any)}
              className="bg-slate-800 text-white text-xs px-2 py-1.5 rounded-md border border-slate-600"
              title="Reemplaza la lista entera o añade a los existentes"
            >
              <option value="replace">Reemplazar asignados</option>
              <option value="add">Añadir a asignados</option>
            </select>
            <div className="flex flex-wrap gap-1">
              {team.map((m) => {
                const sel = assigneeIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleAssignee(m.id)}
                    className={
                      "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition " +
                      (sel ? "bg-brand-600 text-white" : "bg-slate-700 hover:bg-slate-600 text-slate-200")
                    }
                  >
                    <span className={`h-4 w-4 rounded-full text-white grid place-items-center text-[9px] font-semibold ${m.color}`}>
                      {m.initials}
                    </span>
                    {m.name.split(" ")[0]}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <button
        onClick={run}
        disabled={running || (action === "assign" && assigneeIds.length === 0 && assignMode === "replace")}
        className={
          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium shrink-0 disabled:opacity-50 " +
          (action === "delete" ? "bg-rose-600 hover:bg-rose-700" : "bg-brand-600 hover:bg-brand-700")
        }
      >
        {running ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : action === "delete" ? (
          <Trash2 className="h-4 w-4" />
        ) : action === "move_project" ? (
          <FolderInput className="h-4 w-4" />
        ) : action === "assign" ? (
          <Users className="h-4 w-4" />
        ) : (
          <ChevronsRight className="h-4 w-4" />
        )}
        Aplicar
      </button>
      <button
        onClick={onCancel}
        className="h-8 w-8 grid place-items-center rounded-md text-slate-300 hover:bg-slate-800 shrink-0"
      >
        <X className="h-4 w-4" />
      </button>
      {error && (
        <div className="absolute bottom-full mb-2 left-0 right-0 mx-auto text-center text-xs text-rose-300 bg-rose-900/40 border border-rose-700 rounded-md px-2 py-1">
          {error}
        </div>
      )}
    </div>
  );
}
