"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/ui/Modal";
import RichTextEditor from "@/components/editor/RichTextEditor";
import AttachmentList from "@/components/files/AttachmentList";
import CommentEditor from "@/components/forms/CommentEditor";
import CommentRenderer from "@/components/forms/CommentRenderer";
import type { MentionCandidate } from "@/components/forms/mentionSuggestion";
import type { UiProject, UiMember, UiTask } from "@/lib/db/queries";
import { Loader2, Trash2, MessageSquare, X, CheckSquare, Check, ArrowLeft, ExternalLink } from "lucide-react";

type Priority = "urgencia" | "alta";
type KanbanColumn = { id: string; label: string; color: string; order: number; isDone?: boolean };

const priorityOptions: { value: Priority; label: string }[] = [
  { value: "urgencia", label: "🚨 URGENCIA" },
  { value: "alta", label: "Alta" }
];

const priorityToApi: Record<Priority, string> = {
  urgencia: "URGENT",
  alta: "HIGH"
};

type CommentItem = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string | null; image?: string | null };
};

type CurrentTask = UiTask & { _parentId?: string | null };

export default function TaskFormModal({
  open,
  onClose,
  projects,
  team,
  task,
  defaultStatus,
  defaultProjectId,
  columns
}: {
  open: boolean;
  onClose: () => void;
  projects: UiProject[];
  team: UiMember[];
  task?: UiTask | null;
  defaultStatus?: string;
  defaultProjectId?: string;
  columns?: KanbanColumn[];
}) {
  const router = useRouter();

  // Pila de navegación tarea → subtarea. La cima es la tarea actualmente visible.
  const [taskStack, setTaskStack] = useState<CurrentTask[]>([]);
  const currentTask = taskStack[taskStack.length - 1] ?? null;
  const isEdit = !!currentTask;

  // Form fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState<any>(null);
  const [status, setStatus] = useState<string>("TODO");
  const [priority, setPriority] = useState<Priority>("alta");
  // Multi-proyecto: la tarea puede estar en N proyectos. El primero del
  // array es el "principal" (define la columna kanban). projectIds[0]
  // siempre corresponde al projectId del schema.
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const projectId = projectIds[0] ?? "";
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState<string>("");
  const [dueTime, setDueTime] = useState<string>("");
  // Reglas de notificación. null = "usar defaults del backend".
  // Array (incluido []) = preferencia explícita del usuario.
  const [notifyDueRules, setNotifyDueRules] = useState<string[] | null>(null);
  const effectiveRules = notifyDueRules ?? ["day_7am", "1h_before", "10min_before"];
  function toggleRule(r: string) {
    setNotifyDueRules(effectiveRules.includes(r) ? effectiveRules.filter((x) => x !== r) : [...effectiveRules, r]);
  }
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [comments, setComments] = useState<CommentItem[]>([]);
  const [postingComment, setPostingComment] = useState(false);
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
  const editorKey = useRef(0);

  const [subtasks, setSubtasks] = useState<{ id: string; title: string; status: string }[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);

  // Sincroniza la pila con el task que llega por prop al abrir el modal.
  useEffect(() => {
    if (!open) return;
    setTaskStack(task ? [task as CurrentTask] : []);
  }, [open, task]);

  // Cuando cambia la tarea activa (apertura o navegación a subtarea), recarga datos.
  useEffect(() => {
    if (!open) return;
    setError(null);
    editorKey.current++;
    if (currentTask) {
      setTitle(currentTask.title);
      setStatus(String(currentTask.status));
      // currentTask.priority viene del backend mapeado a "alta" o
      // "urgencia"; si por compat llegó algo legacy lo normalizamos.
      setPriority((currentTask.priority === "urgencia" ? "urgencia" : "alta") as Priority);
      setProjectIds(
        Array.isArray((currentTask as any).projectIds) && (currentTask as any).projectIds.length > 0
          ? (currentTask as any).projectIds
          : [currentTask.projectId]
      );
      setAssigneeIds(currentTask.assigneeIds);
      setDueDate(currentTask.dueDate ?? "");
      setDueTime(currentTask.dueAllDay === false && currentTask.dueTime ? currentTask.dueTime : "");
      setNotifyDueRules(Array.isArray(currentTask.notifyDueRules) ? currentTask.notifyDueRules : null);
      // Fetch detalle: descripción + subtareas + comentarios
      fetch(`/api/v1/tasks/${currentTask.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          try {
            setDescription(data.description ? JSON.parse(data.description) : null);
          } catch {
            setDescription(data.description || null);
          }
          setSubtasks(
            (data.subtasks ?? []).map((s: any) => ({
              id: s.id,
              title: s.title,
              status: s.status
            }))
          );
        });
      fetch(`/api/v1/tasks/${currentTask.id}/comments`)
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d) => setComments(d.items ?? []));
    } else {
      setTitle("");
      setDescription(null);
      setStatus(defaultStatus ?? columns?.[0]?.id ?? "TODO");
      setPriority("alta");
      setProjectIds([defaultProjectId ?? projects[0]?.id ?? ""].filter(Boolean) as string[]);
      setAssigneeIds([]);
      setDueDate("");
      setDueTime("");
      setNotifyDueRules(null);
      setComments([]);
      setSubtasks([]);
    }
  }, [open, currentTask?.id, defaultStatus, defaultProjectId, projects, columns]);

  // Carga candidatos a @mención (miembros del workspace) al abrir el
  // modal. Se pasan por prop al CommentEditor; el editor se queda con
  // la ref viva sin recrearse en cada cambio.
  useEffect(() => {
    if (!open) return;
    fetch("/api/v1/users")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) =>
        setMentionCandidates(
          (d.items ?? []).map((u: any) => ({ id: u.id, name: u.name, email: u.email }))
        )
      );
  }, [open]);

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
      projectIds,
      status,
      priority: priorityToApi[priority],
      assigneeIds,
      description: descSerialized,
      notifyDueRules
    };
    if (dueDate) {
      // Construimos el ISO directamente, SIN pasar por new Date(string).
      // Si lo pasamos por Date, el navegador interpreta el string como
      // hora local y al hacer toISOString() la convierte a UTC. Así,
      // 14:30 en CEST se guardaría como 12:30Z y al releer y mostrar
      // .slice(11,16) saldría 12:30 (el user lo ve como "no se guardó").
      // Tratamos la hora del usuario como si fuera UTC: el sistema es
      // consistente y la hora visual se mantiene siempre la que él puso.
      const iso = dueTime
        ? `${dueDate}T${dueTime}:00.000Z`
        : `${dueDate}T00:00:00.000Z`;
      payload.dueDate = iso;
      payload.dueAllDay = !dueTime;
    }
    // Si estamos editando una subtarea, conservamos su parentId (no se pierde)
    if (currentTask?._parentId) payload.parentId = currentTask._parentId;

    const r = await fetch(isEdit ? `/api/v1/tasks/${currentTask!.id}` : "/api/v1/tasks", {
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
    // Si era la última tarea de la pila, cerramos; si era una subtarea, volvemos a la padre
    if (taskStack.length <= 1) {
      onClose();
    } else {
      goBack();
    }
  }

  async function handleDelete() {
    if (!currentTask || !confirm("¿Eliminar esta tarea? No se puede deshacer.")) return;
    setDeleting(true);
    const r = await fetch(`/api/v1/tasks/${currentTask.id}`, { method: "DELETE" });
    setDeleting(false);
    if (!r.ok) return setError("No se pudo eliminar");
    router.refresh();
    if (taskStack.length <= 1) onClose();
    else goBack();
  }

  async function postComment(doc: any) {
    if (!currentTask) return;
    setPostingComment(true);
    const r = await fetch(`/api/v1/tasks/${currentTask.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: JSON.stringify(doc) })
    });
    setPostingComment(false);
    if (!r.ok) return setError("No se pudo publicar el comentario");
    const c = await r.json();
    setComments((prev) => [...prev, c]);
  }

  async function deleteComment(id: string) {
    if (!confirm("¿Borrar este comentario?")) return;
    const r = await fetch(`/api/v1/comments/${id}`, { method: "DELETE" });
    if (r.ok) setComments((prev) => prev.filter((c) => c.id !== id));
  }

  function toggleAssignee(id: string) {
    setAssigneeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function addSubtask() {
    if (!currentTask || !newSubtask.trim()) return;
    setAddingSubtask(true);
    const r = await fetch("/api/v1/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: newSubtask.trim(),
        projectId: currentTask.projectId,
        parentId: currentTask.id
      })
    });
    setAddingSubtask(false);
    if (!r.ok) return setError("No se pudo crear subtarea");
    const created = await r.json();
    setSubtasks((prev) => [...prev, { id: created.id, title: created.title, status: created.status }]);
    setNewSubtask("");
  }

  async function toggleSubtask(id: string, currentStatus: string) {
    const isDone = currentStatus === "DONE";
    const newStatus = isDone ? "TODO" : "DONE";
    setSubtasks((prev) => prev.map((s) => (s.id === id ? { ...s, status: newStatus } : s)));
    await fetch(`/api/v1/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus })
    });
  }

  async function deleteSubtask(id: string) {
    if (!confirm("¿Eliminar subtarea?")) return;
    setSubtasks((prev) => prev.filter((s) => s.id !== id));
    await fetch(`/api/v1/tasks/${id}`, { method: "DELETE" });
  }

  async function openSubtask(subId: string) {
    // Cargar subtarea completa y empujarla a la pila
    const r = await fetch(`/api/v1/tasks/${subId}`);
    if (!r.ok) return;
    const data = await r.json();
    const sub: CurrentTask = {
      id: data.id,
      title: data.title,
      status: data.status,
      assigneeIds: (data.assignees ?? []).map((a: any) => a.userId ?? a.user?.id),
      projectId: data.projectId,
      clientId: data.clientId ?? undefined,
      dueDate: data.dueDate ? new Date(data.dueDate).toISOString().slice(0, 10) : "",
      priority: data.priority === "LOW" ? "baja" : data.priority === "HIGH" || data.priority === "URGENT" ? "alta" : "media",
      tags: (data.tags ?? []).map((t: any) => t.tag?.name ?? "").filter(Boolean),
      _parentId: data.parentId ?? null
    };
    setTaskStack((s) => [...s, sub]);
  }

  function goBack() {
    setTaskStack((s) => s.slice(0, -1));
  }

  const parentInStack = taskStack.length > 1 ? taskStack[taskStack.length - 2] : null;
  const dynamicColumns = columns && columns.length > 0
    ? columns
    : [
        { id: "TODO", label: "Por hacer", color: "", order: 0 },
        { id: "IN_PROGRESS", label: "En curso", color: "", order: 1 },
        { id: "REVIEW", label: "Revisión", color: "", order: 2 },
        { id: "DONE", label: "Hecha", color: "", order: 3 }
      ];

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
      {parentInStack && (
        <button
          type="button"
          onClick={goBack}
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver a "{parentInStack.title}"
        </button>
      )}
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
                placeholder="Describe la tarea… / para bloques, @ para mencionar."
                minHeight={140}
                mentionCandidates={mentionCandidates}
              />
            </div>
          </div>

          {isEdit && (
            <div className="pt-2">
              <div className="text-xs font-medium text-slate-700 mb-2 flex items-center gap-1.5">
                <CheckSquare className="h-3.5 w-3.5" />
                Subtareas
                <span className="text-slate-400">
                  ({subtasks.filter((s) => s.status === "DONE").length}/{subtasks.length})
                </span>
              </div>
              <div className="space-y-1.5">
                {subtasks.map((s) => {
                  const done = s.status === "DONE";
                  return (
                    <div
                      key={s.id}
                      className="flex items-center gap-2 group bg-white border rounded-lg px-2.5 py-1.5 hover:border-brand-200"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSubtask(s.id, s.status)}
                        className={
                          "h-4 w-4 rounded border grid place-items-center transition shrink-0 " +
                          (done
                            ? "bg-brand-600 border-brand-600 text-white"
                            : "border-slate-300 hover:border-brand-400")
                        }
                      >
                        {done && <Check className="h-3 w-3" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => openSubtask(s.id)}
                        className={
                          "text-sm flex-1 text-left hover:text-brand-700 truncate " +
                          (done ? "line-through text-slate-400" : "text-slate-700")
                        }
                        title="Abrir subtarea como tarea completa"
                      >
                        {s.title}
                      </button>
                      <button
                        type="button"
                        onClick={() => openSubtask(s.id)}
                        className="opacity-0 group-hover:opacity-100 h-6 w-6 grid place-items-center rounded text-slate-400 hover:text-brand-600 hover:bg-brand-50"
                        title="Abrir subtarea"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSubtask(s.id)}
                        className="opacity-0 group-hover:opacity-100 h-6 w-6 grid place-items-center rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={newSubtask}
                  onChange={(e) => setNewSubtask(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addSubtask();
                    }
                  }}
                  placeholder="+ Añadir subtarea…"
                  className="flex-1 px-3 py-1.5 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button
                  type="button"
                  onClick={addSubtask}
                  disabled={addingSubtask || !newSubtask.trim()}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm font-medium disabled:opacity-50"
                >
                  Añadir
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">
                💡 Haz clic en una subtarea para abrirla como tarea completa (con sus propios adjuntos, comentarios, etc.).
              </p>
            </div>
          )}

          {isEdit && (
            <div className="pt-2">
              <AttachmentList targetType="TASK" targetId={currentTask!.id} />
            </div>
          )}

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
                      <div className="text-sm text-slate-700 mt-0.5">
                        <CommentRenderer body={c.body} />
                      </div>
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
              <div className="mt-3">
                {currentTask && (
                  <CommentEditor
                    taskId={currentTask.id}
                    submitting={postingComment}
                    onSubmit={postComment}
                    mentionCandidates={mentionCandidates}
                  />
                )}
              </div>
            </div>
          )}

          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>

        <aside className="space-y-3">
          <SidebarField label="Estado">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-2 py-1.5 rounded-md border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {dynamicColumns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
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

          <SidebarField label={`Proyectos (${projectIds.length})`}>
            <div className="space-y-1 max-h-44 overflow-y-auto -mx-1 px-1">
              {projects.map((p) => {
                const sel = projectIds.includes(p.id);
                const isPrimary = projectIds[0] === p.id;
                return (
                  <label
                    key={p.id}
                    className={
                      "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer transition " +
                      (sel ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-50")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={sel}
                      onChange={() => {
                        if (sel) {
                          // Quitar — pero nunca dejar la lista vacía.
                          if (projectIds.length === 1) return;
                          setProjectIds(projectIds.filter((x) => x !== p.id));
                        } else {
                          setProjectIds([...projectIds, p.id]);
                        }
                      }}
                      className="accent-brand-600"
                    />
                    <span className="flex-1 truncate">{p.name}</span>
                    {isPrimary && projectIds.length > 1 && (
                      <span className="text-[9px] uppercase tracking-wide px-1 rounded bg-brand-100 text-brand-700">
                        principal
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            {projectIds.length > 1 && (
              <p className="mt-1 text-[10px] text-slate-500">
                La tarea aparece en los {projectIds.length} proyectos. El "principal" define en qué tablero kanban se mueve.
              </p>
            )}
          </SidebarField>

          <SidebarField label="Fecha y hora de entrega">
            <div className="space-y-1.5">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-2 py-1.5 rounded-md border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                  disabled={!dueDate}
                  placeholder="--:--"
                  className="flex-1 px-2 py-1.5 rounded-md border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-400"
                />
                {dueTime && (
                  <button
                    type="button"
                    onClick={() => setDueTime("")}
                    className="px-2 py-1 text-[11px] rounded-md text-slate-500 hover:bg-slate-100"
                    title="Quitar hora (todo el día)"
                  >
                    Sin hora
                  </button>
                )}
              </div>
              <p className="text-[10px] text-slate-500">
                Si añades hora y te asignas, aparecerá en tu calendario a esa hora exacta.
              </p>
            </div>
          </SidebarField>

          {dueDate && (
            <SidebarField label="Notificaciones por email">
              <div className="space-y-1 text-xs">
                {[
                  { key: "day_7am", label: "El mismo día a las 7:00" },
                  { key: "1h_before", label: "1 hora antes" },
                  { key: "10min_before", label: "10 minutos antes" }
                ].map((r) => {
                  const on = effectiveRules.includes(r.key);
                  return (
                    <label key={r.key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleRule(r.key)}
                        className="accent-brand-600"
                      />
                      <span className={on ? "text-slate-800" : "text-slate-500"}>{r.label}</span>
                    </label>
                  );
                })}
                <p className="text-[10px] text-slate-500 pt-1">
                  Se enviará a cada asignado de la tarea.
                </p>
              </div>
            </SidebarField>
          )}

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

