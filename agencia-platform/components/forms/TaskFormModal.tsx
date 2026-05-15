"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/ui/Modal";
import RichTextEditor from "@/components/editor/RichTextEditor";
import type { UiProject, UiMember, UiTask } from "@/lib/db/queries";
import { Loader2, Trash2, MessageSquare, Send, X } from "lucide-react";

type Status = "todo" | "in_progress" | "review" | "done";
type Priority = "baja" | "media" | "alta";

const statusOptions: { value: Status; label: string; color: string }[] = [
  { value: "todo", label: "Por hacer", color: "bg-slate-100 text-slate-700" },
  { value: "in_progress", label: "En curso", color: "bg-sky-100 text-sky-800" },
  { value: "review", label: "Revisión", color: "bg-amber-100 text-amber-800" },
  { value: "done", label: "Hecha", color: "bg-emerald-100 text-emerald-800" }
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

type CommentItem = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string | null; image?: string | null };
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
  const [description, setDescription] = useState<any>(null);
  const [status, setStatus] = useState<Status>("todo");
  const [priority, setPriority] = useState<Priority>("media");
  const [projectId, setProjectId] = useState<string>("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [comments, setComments] = useState<CommentItem[]>([]);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const editorKey = useRef(0);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNewComment("");
    editorKey.current++;
    if (task) {
      setTitle(task.title);
      setStatus(task.status);
      setPriority(task.priority);
      setProjectId(task.projectId);
      setAssigneeIds(task.assigneeIds);
      setDueDate(task.dueDate ?? "");
      // Cargar descripción y comentarios desde el endpoint de detalle
      fetch(`/api/v1/tasks/${task.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          try {
            setDescription(data.description ? JSON.parse(data.description) : null);
          } catch {
            setDescription(data.description || null);
          }
        });
      fetch(`/api/v1/tasks/${task.id}/comments`)
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d) => setComments(d.items ?? []));
    } else {
      setTitle("");
      setDescription(null);
      setStatus(defaultStatus ?? "todo");
      setPriority("media");
      setProjectId(defaultProjectId ?? projects[0]?.id ?? "");
      setAssigneeIds([]);
      setDueDate("");
      setComments([]);
    }
  }, [open, task, defaultStatus, defaultProjectId, projects]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError("El título es obligatorio");
    if (!projectId) return setError("Selecciona un proyecto");

    setSaving(true);
    const descSerialized = description
      ? typeof description === "string"
        ? description
        : JSON.stringify(description)
      : undefined;
    const payload: any = {
      title: title.trim(),
      projectId,
      status: statusToApi[status],
      priority: priorityToApi[priority],
      assigneeIds,
      description: descSerialized
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

  async function postComment() {
    if (!task || !newComment.trim()) return;
    setPostingComment(true);
    const r = await fetch(`/api/v1/tasks/${task.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: newComment.trim() })
    });
    setPostingComment(false);
    if (!r.ok) return setError("No se pudo publicar el comentario");
    const c = await r.json();
    setComments((prev) => [...prev, c]);
    setNewComment("");
  }

  async function deleteComment(id: string) {
    if (!confirm("¿Borrar este comentario?")) return;
    const r = await fetch(`/api/v1/comments/${id}`, { method: "DELETE" });
    if (r.ok) setComments((prev) => prev.filter((c) => c.id !== id));
  }

  function toggleAssignee(id: string) {
    setAssigneeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Tarea" : "Nueva tarea"}
      size="xl"
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
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">
            Cancelar
          </button>
          <button
            type="submit"
            form="task-form"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Guardar" : "Crear tarea"}
          </button>
        </>
      }
    >
      <form id="task-form" onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-6">
        <div className="space-y-4 min-w-0">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            className="w-full text-lg font-semibold px-0 py-1 bg-transparent border-0 border-b border-transparent focus:border-brand-500 focus:outline-none focus:ring-0"
            placeholder="Título de la tarea…"
          />

          <div>
            <div className="text-xs font-medium text-slate-700 mb-1">Descripción</div>
            <div className="border rounded-lg p-3 bg-white">
              <RichTextEditor
                key={editorKey.current}
                initialContent={description}
                onChange={setDescription}
                placeholder="Describe la tarea, añade pasos, contexto…"
                minHeight={140}
              />
            </div>
          </div>

          {isEdit && (
            <div className="pt-2">
              <div className="text-xs font-medium text-slate-700 mb-2 flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" />
                Comentarios
                <span className="text-slate-400">({comments.length})</span>
              </div>
              <div className="space-y-3">
                {comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-2.5 group">
                    <div className="h-7 w-7 rounded-full bg-brand-500 text-white grid place-items-center text-[11px] font-semibold shrink-0">
                      {initialsFromName(c.author.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium">{c.author.name ?? "Usuario"}</span>
                        <span className="text-[11px] text-slate-500">
                          {new Date(c.createdAt).toLocaleString("es-ES", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap mt-0.5">{c.body}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteComment(c.id)}
                      className="opacity-0 group-hover:opacity-100 h-7 w-7 grid place-items-center rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                      title="Borrar"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {comments.length === 0 && (
                  <p className="text-xs text-slate-500 italic">Aún no hay comentarios.</p>
                )}
              </div>
              <div className="mt-3 flex items-start gap-2">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      postComment();
                    }
                  }}
                  rows={2}
                  placeholder="Escribe un comentario… (Cmd/Ctrl+Enter para enviar)"
                  className="flex-1 px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button
                  type="button"
                  onClick={postComment}
                  disabled={postingComment || !newComment.trim()}
                  className="px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {postingComment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>

        <aside className="space-y-3">
          <SidebarField label="Estado">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
              className="w-full px-2 py-1.5 rounded-md border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </SidebarField>

          <SidebarField label="Prioridad">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="w-full px-2 py-1.5 rounded-md border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {priorityOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </SidebarField>

          <SidebarField label="Proyecto">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full px-2 py-1.5 rounded-md border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="" disabled>Selecciona…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </SidebarField>

          <SidebarField label="Fecha de entrega">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-2 py-1.5 rounded-md border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </SidebarField>

          <SidebarField label={`Asignados (${assigneeIds.length})`}>
            <div className="space-y-1 max-h-40 overflow-y-auto -mx-1 px-1">
              {team.map((m) => {
                const sel = assigneeIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleAssignee(m.id)}
                    className={
                      "w-full inline-flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition " +
                      (sel ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-50")
                    }
                  >
                    <span className={`h-5 w-5 rounded-full text-white grid place-items-center text-[10px] font-semibold ${m.color}`}>
                      {m.initials}
                    </span>
                    <span className="flex-1 text-left truncate">{m.name}</span>
                    {sel && <span className="text-brand-600">✓</span>}
                  </button>
                );
              })}
              {team.length === 0 && <p className="text-xs text-slate-500 px-2">Sin miembros</p>}
            </div>
          </SidebarField>
        </aside>
      </form>
    </Modal>
  );
}

function SidebarField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium mb-1">{label}</div>
      {children}
    </div>
  );
}

function initialsFromName(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
