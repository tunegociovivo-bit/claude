"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";

/**
 * Modal de confirmación doble para borrar un proyecto. El user tiene
 * que ESCRIBIR el nombre exacto del proyecto para habilitar el botón
 * de borrar — patrón estilo GitHub/Vercel. Así un click accidental
 * sobre el icono de papelera no destruye un proyecto entero.
 *
 * Doble capa:
 *   1) Frontend: confirmación tipográfica (nombre exacto) + botón
 *      destructivo en rojo + delay visual.
 *   2) API: ?confirm=<id> debe coincidir con el id del proyecto
 *      (ya validado en /api/v1/projects/[id] DELETE).
 *
 * También mostramos el contador de tareas que se van a destruir y
 * deshabilitamos cierres accidentales (no se cierra al pulsar fuera
 * mientras hay texto escrito).
 */
export default function DeleteProjectModal({
  open,
  project,
  onClose,
  onDeleted
}: {
  open: boolean;
  project: { id: string; name: string } | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !project) return;
    setTyped("");
    setError(null);
    setTaskCount(null);
    fetch(`/api/v1/projects/${project.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setTaskCount(d?._count?.tasks ?? 0))
      .catch(() => setTaskCount(0));
  }, [open, project]);

  if (!open || !project) return null;

  const matches = typed.trim() === project.name.trim();

  async function handleDelete() {
    if (!project || !matches || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const r = await fetch(`/api/v1/projects/${project.id}?confirm=${project.id}`, {
        method: "DELETE"
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `Error ${r.status}`);
      }
      onDeleted();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo eliminar el proyecto");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[95] bg-slate-900/50 backdrop-blur-sm grid place-items-center p-4"
      onMouseDown={(e) => {
        // No cerrar al pulsar fuera si ya empezó a escribir — evitamos
        // perder el progreso si toca por error el backdrop.
        if (e.target === e.currentTarget && !typed && !deleting) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center gap-2 bg-rose-50">
          <AlertTriangle className="h-5 w-5 text-rose-600" />
          <h3 className="font-semibold text-rose-900 flex-1">Eliminar proyecto</h3>
          {!deleting && (
            <button onClick={onClose} className="p-1 hover:bg-rose-100 rounded">
              <X className="h-4 w-4 text-rose-700" />
            </button>
          )}
        </div>

        <div className="px-5 py-5 space-y-4">
          <div className="text-sm text-slate-700">
            Vas a eliminar <span className="font-semibold text-slate-900">{project.name}</span>{" "}
            permanentemente. Esta acción no se puede deshacer.
          </div>

          <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2.5 text-sm text-rose-900">
            <div className="font-medium mb-1">Se borrarán también:</div>
            <ul className="list-disc list-inside space-y-0.5 text-rose-800">
              <li>
                {taskCount === null ? "Cargando…" : `${taskCount} tarea${taskCount === 1 ? "" : "s"}`}{" "}
                con sus subtareas, comentarios y adjuntos
              </li>
              <li>Asignaciones de miembros al proyecto</li>
              <li>Columnas personalizadas y configuración del kanban</li>
            </ul>
          </div>

          <label className="block text-sm">
            <div className="text-slate-700 mb-1.5">
              Para confirmar, escribe{" "}
              <span className="font-mono font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">
                {project.name}
              </span>
            </div>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              disabled={deleting}
              placeholder={project.name}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-200 disabled:bg-slate-50"
            />
          </label>

          {error && (
            <div className="rounded-lg bg-rose-100 border border-rose-300 px-3 py-2 text-sm text-rose-900">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-end gap-2 bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!matches || deleting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-700 text-white disabled:bg-rose-300 disabled:cursor-not-allowed"
          >
            {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
            Eliminar proyecto
          </button>
        </div>
      </div>
    </div>
  );
}
