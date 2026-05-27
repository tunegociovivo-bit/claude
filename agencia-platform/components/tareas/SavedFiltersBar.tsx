"use client";

import { useEffect, useState } from "react";
import { Save, Star, X, Bookmark } from "lucide-react";

/**
 * Conjunto de filtros aplicables a la vista de tareas. Cada campo
 * acepta su valor "abierto" (todos / sin filtrar) representado por
 * "all", "any" o "". El componente padre interpreta y filtra.
 */
export type TaskFilters = {
  project: string;         // projectId o "all"
  client: string;          // clientId o "all"
  priority: string;        // priority o "all"
  status: string;          // statusId o "all"
  assignee: string;        // userId o "all" | "me" | "none"
  due: "all" | "overdue" | "today" | "week" | "no-date";
  q: string;
};

export const DEFAULT_FILTERS: TaskFilters = {
  project: "all",
  client: "all",
  priority: "all",
  status: "all",
  assignee: "all",
  due: "all",
  q: ""
};

type Preset = { id: string; name: string; filters: TaskFilters };

const STORAGE_KEY = "task-filter-presets-v1";

/**
 * Barra de presets guardados en localStorage del navegador (por user
 * + dispositivo). Para presets compartidos por workspace haría falta
 * una tabla nueva en BD; lo dejamos para una iteración futura.
 */
export default function SavedFiltersBar({
  filters,
  onApply
}: {
  filters: TaskFilters;
  onApply: (f: TaskFilters) => void;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setPresets(JSON.parse(raw));
    } catch {}
  }, []);

  function persist(next: Preset[]) {
    setPresets(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }

  function savePreset() {
    if (!name.trim()) return;
    const p: Preset = { id: crypto.randomUUID(), name: name.trim(), filters };
    persist([...presets, p]);
    setName("");
    setNaming(false);
  }

  function removePreset(id: string) {
    persist(presets.filter((p) => p.id !== id));
  }

  const isDirty = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Bookmark className="h-3.5 w-3.5 text-slate-400" />
      {presets.length === 0 && !isDirty && (
        <span className="text-xs text-slate-500 italic">
          Aplica filtros y pulsa "Guardar" para recordar la combinación.
        </span>
      )}
      {presets.map((p) => (
        <span
          key={p.id}
          className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-full bg-slate-100 hover:bg-brand-50 text-xs text-slate-700 hover:text-brand-700 group"
        >
          <button type="button" onClick={() => onApply(p.filters)} className="inline-flex items-center gap-1">
            <Star className="h-3 w-3" />
            {p.name}
          </button>
          <button
            type="button"
            onClick={() => removePreset(p.id)}
            className="h-4 w-4 rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50 grid place-items-center opacity-0 group-hover:opacity-100"
            title="Borrar preset"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {isDirty && !naming && (
        <button
          type="button"
          onClick={() => setNaming(true)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-brand-600 text-white text-xs hover:bg-brand-700"
        >
          <Save className="h-3 w-3" /> Guardar filtro
        </button>
      )}
      {naming && (
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") savePreset();
              if (e.key === "Escape") {
                setNaming(false);
                setName("");
              }
            }}
            placeholder="Nombre del filtro…"
            className="px-2 py-1 rounded border text-xs"
          />
          <button
            type="button"
            onClick={savePreset}
            className="px-2 py-1 rounded bg-brand-600 text-white text-xs"
          >
            OK
          </button>
        </span>
      )}
      {isDirty && (
        <button
          type="button"
          onClick={() => onApply(DEFAULT_FILTERS)}
          className="text-xs text-slate-500 hover:text-slate-700 underline"
        >
          limpiar
        </button>
      )}
    </div>
  );
}
