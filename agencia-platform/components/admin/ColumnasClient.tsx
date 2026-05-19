"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { Plus, Loader2, Trash2, GripVertical, ArrowDown, ArrowUp, AlertTriangle, ArrowLeft } from "lucide-react";

type Column = {
  id: string;
  label: string;
  color: string;
  order: number;
  isDone?: boolean;
};

const COLOR_PRESETS = [
  { label: "Gris", value: "bg-slate-100 text-slate-700 border-slate-200" },
  { label: "Azul", value: "bg-sky-100 text-sky-800 border-sky-300" },
  { label: "Índigo", value: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  { label: "Ámbar", value: "bg-amber-100 text-amber-800 border-amber-300" },
  { label: "Verde", value: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  { label: "Rosa", value: "bg-rose-100 text-rose-800 border-rose-300" },
  { label: "Violeta", value: "bg-violet-100 text-violet-800 border-violet-300" }
];

function slugifyId(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export default function ColumnasClient() {
  const searchParams = useSearchParams();
  const projectId = searchParams?.get("project") ?? null;
  const [columns, setColumns] = useState<Column[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [scope, setScope] = useState<"workspace" | "project" | "workspace_fallback">("workspace");

  async function load() {
    setLoading(true);
    if (projectId) {
      // Carga las columnas del proyecto (per-project endpoint) y el
      // nombre del proyecto en paralelo (para el header).
      const [colsR, projR] = await Promise.all([
        fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/kanban-columns`),
        fetch(`/api/v1/projects/${encodeURIComponent(projectId)}`)
      ]);
      if (colsR.ok) {
        const d = await colsR.json();
        setColumns((d.items ?? []).map((c: any, i: number) => ({ ...c, order: c.order ?? i })));
        // source viene del endpoint per-project: "project" o "workspace_fallback"
        setScope(d.source === "project" ? "project" : "workspace_fallback");
      }
      if (projR.ok) {
        const proj = await projR.json();
        setProjectName(proj?.name ?? null);
      }
    } else {
      const r = await fetch("/api/v1/kanban-columns");
      if (r.ok) {
        const d = await r.json();
        setColumns((d.items ?? []).map((c: any, i: number) => ({ ...c, order: c.order ?? i })));
        setScope("workspace");
        setProjectName(null);
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function addColumn() {
    const idx = columns.length;
    let id = `COLUMNA_${idx + 1}`;
    while (columns.some((c) => c.id === id)) id = `COLUMNA_${idx + 1 + Math.floor(Math.random() * 100)}`;
    setColumns([
      ...columns,
      { id, label: `Columna ${idx + 1}`, color: COLOR_PRESETS[0].value, order: idx, isDone: false }
    ]);
    setDirty(true);
  }

  function updateColumn(idx: number, patch: Partial<Column>) {
    setColumns(columns.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
    setDirty(true);
  }

  function removeColumn(idx: number) {
    const col = columns[idx];
    if (
      !confirm(
        `¿Eliminar la columna "${col.label}"?\n\nLas tareas que estuvieran en ella permanecerán pero quedarán huérfanas hasta que las muevas manualmente.`
      )
    )
      return;
    setColumns(columns.filter((_, i) => i !== idx).map((c, i) => ({ ...c, order: i })));
    setDirty(true);
  }

  function move(idx: number, dir: -1 | 1) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= columns.length) return;
    const next = columns.slice();
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    next.forEach((c, i) => (c.order = i));
    setColumns(next);
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    // Validar IDs
    const ids = columns.map((c) => c.id);
    if (new Set(ids).size !== ids.length) {
      setError("Hay IDs duplicados");
      setSaving(false);
      return;
    }
    const putUrl = projectId
      ? `/api/v1/projects/${encodeURIComponent(projectId)}/kanban-columns`
      : "/api/v1/kanban-columns";
    const r = await fetch(putUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columns: columns.map((c, i) => ({ ...c, order: i })) })
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    setDirty(false);
    load();
  }

  const titleDesc =
    scope === "project"
      ? `Editando columnas del proyecto «${projectName ?? "?"}». Solo afecta a este proyecto.`
      : scope === "workspace_fallback"
        ? `El proyecto «${projectName ?? "?"}» no tiene columnas propias. Estás viendo las del workspace. Si guardas aquí, creas columnas propias del proyecto a partir de las globales.`
        : "Personaliza las columnas que aparecen en /tareas. Aplica a todo el workspace (default para proyectos sin columnas propias).";

  return (
    <div className="max-w-4xl mx-auto">
      {projectId && (
        <Link
          href={`/tareas?project=${projectId}`}
          className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="h-3 w-3" /> Volver al tablero del proyecto
        </Link>
      )}
      <PageHeader
        title={
          scope === "project" || scope === "workspace_fallback"
            ? `Columnas — ${projectName ?? "proyecto"}`
            : "Columnas del Kanban"
        }
        description={titleDesc}
        actions={
          <>
            <button
              onClick={addColumn}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border text-sm hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" />
              Añadir columna
            </button>
            <button
              onClick={save}
              disabled={!dirty || saving || columns.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar cambios
            </button>
          </>
        }
      />

      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-800 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <div className="space-y-2">
          {columns.map((c, i) => (
            <div key={c.id + i} className="bg-white rounded-xl border p-3 flex items-center gap-3">
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="h-5 w-5 grid place-items-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === columns.length - 1}
                  className="h-5 w-5 grid place-items-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
              </div>
              <GripVertical className="h-4 w-4 text-slate-300" />
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_140px_180px] gap-2 items-center">
                <input
                  value={c.label}
                  onChange={(e) => updateColumn(i, { label: e.target.value })}
                  className="px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="Nombre"
                />
                <input
                  value={c.id}
                  onChange={(e) => updateColumn(i, { id: slugifyId(e.target.value) })}
                  className="px-3 py-2 rounded-lg border bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="ID"
                />
                <select
                  value={c.color}
                  onChange={(e) => updateColumn(i, { color: e.target.value })}
                  className="px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {COLOR_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-md border ${c.color}`}>{c.label}</span>
              <label className="text-xs text-slate-500 inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={c.isDone ?? false}
                  onChange={(e) => updateColumn(i, { isDone: e.target.checked })}
                />
                Es "Hecha"
              </label>
              <button
                onClick={() => removeColumn(i)}
                className="h-8 w-8 grid place-items-center rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {columns.length === 0 && (
            <div className="bg-white rounded-xl border p-10 text-center text-sm text-slate-500">
              No hay columnas. <button onClick={addColumn} className="text-brand-600 underline">Añade la primera</button>
            </div>
          )}
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500 leading-relaxed">
        El <strong>ID</strong> de cada columna es lo que se guarda en cada tarea. Si renombras un ID existente, las tareas con ese ID antiguo quedarán huérfanas. Si quieres renombrar, mejor crea una nueva, mueve las tareas y borra la antigua. Marca <strong>"Es 'Hecha'"</strong> para que cuando una tarea entre en esa columna se considere completada (se sella <code>completedAt</code>).
      </p>
    </div>
  );
}
