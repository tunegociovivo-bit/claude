"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/ui/Modal";
import type { UiProject, UiMember, UiTask } from "@/lib/db/queries";
import { Loader2, Trash2 } from "lucide-react";

type Status = "todo" | "in_progress" | "review" | "done";
type Priority = "baja" | "media" | "alta";

const statusOptions: { value: Status; label: string }[] = [
  { value: "todo", label: "Por hacer" },
  { value: "in_progress", label: "En curso" },
  { value: "review", label: "Revisión" },
  { value: "done", label: "Hecha" }
];

const priorityOptions: { value: Priority; label: string }[] = [
  { value: "baja", label: "Baja" },
  { value: "media", label: "Media" },
  { value: "alta", label: "Alta" }
];

const statusToApi: Record<Status, string> = {
  todo: "TODO",
  in_progress: "IN_PROGRESS",
  review: "REVIEW",
  done: "DONE"
};

const priorityToApi: Record<Priority, string> = {
  baja: "LOW",
  media: "MEDIUM",
  alta: "HIGH"
};

export default function TaskFormModal({
  open,
  onClose,
  projects,
  team,
  task,
  defaultStatus,
  defaultProjectId
}: {
  open: boolean;
  onClose: () => void;
  projects: UiProject[];
  team: UiMember[];
  task?: UiTask | null;
  defaultStatus?: Status;
  defaultProjectId?: string;
}) {
  const router = useRouter();
  const isEdit = !!task;

  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<Status>("todo");
  const [priority, setPriority] = useState<Priority>("media");
  const [projectId, setProjectId] = useState<string>("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (task) {
      setTitle(task.title);
      setStatus(task.status);
      setPriority(task.priority);
      setProjectId(task.projectId);
      setAssigneeIds(task.assigneeIds);
      setDueDate(task.dueDate ?? "");
    } else {
      setTitle("");
      setStatus(defaultStatus ?? "todo");
      setPriority("media");
      setProjectId(defaultProjectId ?? projects[0]?.id ?? "");
      setAssigneeIds([]);
      setDueDate("");
    }
  }, [open, task, defaultStatus, defaultProjectId, projects]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError("El título es obligatorio");
    if (!projectId) return setError("Selecciona un proyecto");

    setSaving(true);
    const payload: any = {
      title: title.trim(),
      projectId,
      status: statusToApi[status],
      priority: priorityToApi[priority],
      assigneeIds
    };
    if (dueDate) payload.dueDate = new Date(dueDate).toISOString();

    const r = await fetch(isEdit ? `/api/v1/tasks/${task!.id}` : "/api/v1/tasks", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return setError(j.message || `Error ${r.status}`);
    }
    router.refresh();
    onClose();
  }

  async function handleDelete() {
    if (!task || !confirm("¿Eliminar esta tarea? No se puede deshacer.")) return;
    setDeleting(true);
    const r = await fetch(`/api/v1/tasks/${task.id}`, { method: "DELETE" });
    setDeleting(false);
    if (!r.ok) return setError("No se pudo eliminar");
    router.refresh();
    onClose();
  }

  function toggleAssignee(id: string) {
    setAssigneeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar tarea" : "Nueva tarea"}
      size="lg"
      footer={
        <>
          {isEdit && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting || saving}
              className="mr-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Eliminar
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="task-form"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Guardar cambios" : "Crear tarea"}
          </button>
        </>
      }
    >
      <form id="task-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Título</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Ej. Programar reel de lanzamiento"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Proyecto</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="" disabled>Selecciona…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Fecha de entrega</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Estado</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Prioridad</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {priorityOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Asignados</label>
          <div className="flex flex-wrap gap-2">
            {team.map((m) => {
              const sel = assigneeIds.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleAssignee(m.id)}
                  className={
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition " +
                    (sel ? "bg-brand-50 border-brand-300 text-brand-700" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")
                  }
                >
                  <span className={`h-5 w-5 rounded-full text-white grid place-items-center text-[10px] font-semibold ${m.color}`}>
                    {m.initials}
                  </span>
                  {m.name}
                </button>
              );
            })}
            {team.length === 0 && <span className="text-xs text-slate-500">No hay miembros en el workspace</span>}
          </div>
        </div>

        {error && <p className="text-xs text-rose-600">{error}</p>}
      </form>
    </Modal>
  );
}
