/**
 * Tipos y defaults para la configuración de columnas del Kanban.
 * Mantenido aquí (no en app/api/.../route.ts) para que Next.js no se queje
 * de exports que no son métodos de ruta.
 */

export type KanbanColumn = {
  id: string;
  label: string;
  color: string;
  order: number;
  isDone?: boolean;
};

export const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: "TODO", label: "Por hacer", color: "bg-slate-100 text-slate-700 border-slate-200", order: 0 },
  { id: "IN_PROGRESS", label: "En curso", color: "bg-sky-100 text-sky-800 border-sky-300", order: 1 },
  { id: "REVIEW", label: "Revisión", color: "bg-amber-100 text-amber-800 border-amber-300", order: 2 },
  { id: "DONE", label: "Hecha", color: "bg-emerald-100 text-emerald-800 border-emerald-300", order: 3, isDone: true }
];

export function readKanbanColumns(settings: any): KanbanColumn[] {
  const cols = settings?.kanban?.columns;
  if (!Array.isArray(cols) || cols.length === 0) return DEFAULT_COLUMNS;
  return cols
    .map((c: any, i: number) => ({
      id: String(c.id),
      label: String(c.label ?? c.id),
      color: String(c.color ?? "bg-slate-100 text-slate-700 border-slate-200"),
      order: typeof c.order === "number" ? c.order : i,
      isDone: c.isDone === true
    }))
    .sort((a, b) => a.order - b.order);
}
