"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { KanbanColumn } from "@/lib/kanban";

/**
 * Controles del widget: proyecto, columna y alcance (mías / todas).
 * - La elección viaja en la URL (?project&col&scope) para que el
 *   acceso directo de la pantalla de inicio abra siempre tu vista.
 * - Además se guarda en localStorage; si abres /widget sin parámetros
 *   (p.ej. el atajo "Reuniones" del manifest), restauramos lo último
 *   que elegiste.
 */

const LS_KEY = "hub.widget.prefs.v1";

type Current = { project: string; col: string; scope: "me" | "all" };

export default function WidgetControls({
  projects,
  columns,
  current
}: {
  projects: { id: string; name: string; color: string | null }[];
  columns: KanbanColumn[];
  current: Current;
}) {
  const router = useRouter();

  // Al entrar sin parámetros en la URL, restaurar la última elección.
  useEffect(() => {
    const noParams = current.project === "all" && current.col === "all" && current.scope === "me";
    if (!noParams) return;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<Current>;
      const href = buildHref({
        project: saved.project ?? "all",
        col: saved.col ?? "all",
        scope: saved.scope === "all" ? "all" : "me"
      });
      if (href !== "/widget") router.replace(href);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply(next: Current) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {}
    router.push(buildHref(next));
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <select
        value={current.project}
        onChange={(e) => apply({ ...current, project: e.target.value })}
        className="col-span-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      >
        <option value="all">Todos los proyectos</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <select
        value={current.col}
        onChange={(e) => apply({ ...current, col: e.target.value })}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      >
        <option value="all">Cualquier columna</option>
        {columns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>

      <select
        value={current.scope}
        onChange={(e) => apply({ ...current, scope: e.target.value === "all" ? "all" : "me" })}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      >
        <option value="me">Solo mías</option>
        <option value="all">Todo el equipo</option>
      </select>
    </div>
  );
}

function buildHref(c: Current): string {
  const q = new URLSearchParams();
  if (c.project && c.project !== "all") q.set("project", c.project);
  if (c.col && c.col !== "all") q.set("col", c.col);
  if (c.scope === "all") q.set("scope", "all");
  const s = q.toString();
  return s ? `/widget?${s}` : "/widget";
}
