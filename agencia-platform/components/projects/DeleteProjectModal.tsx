"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Loader2, RotateCcw, Trash2, X } from "lucide-react";

/**
 * Modal de confirmación doble para borrar (soft) un proyecto. Flujo:
 *   Paso 1 — Decidir qué hacer con las tareas:
 *     a) Borrar todo junto (las tareas viajan a la papelera con el
 *        proyecto y se restauran juntas).
 *     b) Mover tareas a OTRO proyecto antes de borrar (las tareas
 *        sobreviven, el proyecto se va vacío a la papelera).
 *   Paso 2 — Escribir el nombre exacto del proyecto para habilitar
 *     el botón rojo (type-to-confirm).
 *
 * Doble capa de seguridad:
 *   - Frontend: type-to-confirm exacto + paso explícito de qué hacer
 *     con las tareas.
 *   - API: ?confirm=<id> debe coincidir con el id del proyecto.
 *
 * Soft delete: el proyecto y sus tareas quedan recuperables 30 días
 * desde /admin/papelera.
 */
export default function DeleteProjectModal({
  open,
  project,
  allProjects,
  onClose,
  onDeleted
}: {
  open: boolean;
  project: { id: string; name: string } | null;
  // Para el desplegable de "mover tareas a…". Excluye el proyecto que
  // se está borrando. Si no se pasa, ocultamos la opción.
  allProjects?: { id: string; name: string }[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const [strategy, setStrategy] = useState<"all" | "move">("all");
  const [destinationId, setDestinationId] = useState<string>("");
  const [step, setStep] = useState<"strategy" | "confirm">("strategy");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !project) return;
    setTyped("");
    setError(null);
    setTaskCount(null);
    setStrategy("all");
    setDestinationId("");
    setStep("strategy");
    fetch(`/api/v1/projects/${project.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setTaskCount(d?._count?.tasks ?? 0))
      .catch(() => setTaskCount(0));
  }, [open, project]);

  if (!open || !project) return null;

  const matches = typed.trim() === project.name.trim();
  const otherProjects = (allProjects ?? []).filter((p) => p.id !== project.id);
  const canProceed =
    strategy === "all" || (strategy === "move" && !!destinationId);

  async function handleConfirm() {
    if (!project || !matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (strategy === "move" && destinationId) {
        const mv = await fetch(`/api/v1/projects/${project.id}/move-tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ destinationProjectId: destinationId })
        });
        if (!mv.ok) {
          const j = await mv.json().catch(() => ({}));
          throw new Error(j?.error?.message ?? `Error al mover tareas (${mv.status})`);
        }
      }
      const del = await fetch(`/api/v1/projects/${project.id}?confirm=${project.id}`, {
        method: "DELETE"
      });
      if (!del.ok) {
        const j = await del.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `Error al borrar (${del.status})`);
      }
      onDeleted();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo completar la operación");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[95] bg-slate-900/50 backdrop-blur-sm grid place-items-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !typed && !busy && step === "strategy") onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center gap-2 bg-rose-50">
          <AlertTriangle className="h-5 w-5 text-rose-600" />
          <h3 className="font-semibold text-rose-900 flex-1">
            Eliminar proyecto {step === "confirm" && "— confirmación final"}
          </h3>
          {!busy && (
            <button onClick={onClose} className="p-1 hover:bg-rose-100 rounded">
              <X className="h-4 w-4 text-rose-700" />
            </button>
          )}
        </div>

        <div className="px-5 py-5 space-y-4">
          <div className="text-sm text-slate-700">
            Vas a eliminar <span className="font-semibold text-slate-900">{project.name}</span>.
            <div className="text-xs text-slate-500 mt-1 flex items-start gap-1.5">
              <RotateCcw className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" />
              <span>
                Borrado <strong>reversible</strong>: el proyecto irá a la papelera y se podrá
                restaurar durante 30 días desde <code className="text-[10px] bg-slate-100 px-1 rounded">/admin/papelera</code>.
              </span>
            </div>
          </div>

          {step === "strategy" && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                ¿Qué hacemos con las{" "}
                {taskCount === null ? "…" : `${taskCount} tarea${taskCount === 1 ? "" : "s"}`}?
              </div>
              <label
                className={`block rounded-lg border p-3 cursor-pointer ${
                  strategy === "all" ? "border-rose-400 bg-rose-50" : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="strategy"
                    checked={strategy === "all"}
                    onChange={() => setStrategy("all")}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-900">
                      Borrar proyecto y tareas juntos
                    </div>
                    <div className="text-xs text-slate-600">
                      Todo viaja a la papelera y se restaura junto. Opción por defecto.
                    </div>
                  </div>
                </div>
              </label>

              {otherProjects.length > 0 && (
                <label
                  className={`block rounded-lg border p-3 cursor-pointer ${
                    strategy === "move" ? "border-rose-400 bg-rose-50" : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="strategy"
                      checked={strategy === "move"}
                      onChange={() => setStrategy("move")}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-slate-900 flex items-center gap-1.5">
                        Mover tareas a otro proyecto
                        <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                      </div>
                      <div className="text-xs text-slate-600 mb-2">
                        Las tareas se conservan en el destino. El proyecto se va vacío a la papelera.
                      </div>
                      <select
                        value={destinationId}
                        onChange={(e) => setDestinationId(e.target.value)}
                        disabled={strategy !== "move"}
                        className="w-full text-sm px-2 py-1.5 rounded border border-slate-300 disabled:bg-slate-50 disabled:text-slate-400"
                      >
                        <option value="">— Elige proyecto destino —</option>
                        {otherProjects.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </label>
              )}
            </div>
          )}

          {step === "confirm" && (
            <>
              <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2.5 text-sm text-rose-900">
                <div className="font-medium mb-1">Resumen:</div>
                <ul className="list-disc list-inside space-y-0.5 text-rose-800">
                  {strategy === "all" ? (
                    <li>
                      Se mandarán a la papelera el proyecto y sus{" "}
                      {taskCount ?? 0} tarea{taskCount === 1 ? "" : "s"} (con subtareas,
                      comentarios y adjuntos).
                    </li>
                  ) : (
                    <li>
                      Las {taskCount ?? 0} tarea{taskCount === 1 ? "" : "s"} se moverán a{" "}
                      <span className="font-semibold">
                        {otherProjects.find((p) => p.id === destinationId)?.name}
                      </span>. El proyecto irá a la papelera vacío.
                    </li>
                  )}
                  <li>Recuperable durante 30 días desde la papelera.</li>
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
                  disabled={busy}
                  placeholder={project.name}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-200 disabled:bg-slate-50"
                />
              </label>
            </>
          )}

          {error && (
            <div className="rounded-lg bg-rose-100 border border-rose-300 px-3 py-2 text-sm text-rose-900">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-end gap-2 bg-slate-50">
          {step === "confirm" && !busy && (
            <button
              type="button"
              onClick={() => setStep("strategy")}
              className="mr-auto px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              ← Atrás
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          {step === "strategy" ? (
            <button
              type="button"
              onClick={() => setStep("confirm")}
              disabled={!canProceed}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-700 text-white disabled:bg-rose-300 disabled:cursor-not-allowed"
            >
              Continuar
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!matches || busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-700 text-white disabled:bg-rose-300 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {strategy === "move" ? "Mover y eliminar" : "Eliminar proyecto"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
