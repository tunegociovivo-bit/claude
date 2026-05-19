"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/ui/Modal";
import RichTextEditor from "@/components/editor/RichTextEditor";
import AttachmentList from "@/components/files/AttachmentList";
import CommentEditor from "@/components/forms/CommentEditor";
import CommentRenderer from "@/components/forms/CommentRenderer";
import MeetingRecorder from "@/components/forms/MeetingRecorder";
import type { MentionCandidate } from "@/components/forms/mentionSuggestion";
import type { UiProject, UiMember, UiTask } from "@/lib/db/queries";
import { Loader2, Trash2, MessageSquare, X, CheckSquare, Check, ArrowLeft, ExternalLink, Mic, RefreshCw, Bot } from "lucide-react";

// Tres estados de prioridad: vacío (normal, default), Alta y URGENCIA.
// El campo `priority` puede ser undefined cuando el user no marca nada,
// y eso se mapea a MEDIUM en la BD (la prioridad neutra).
type Priority = "urgencia" | "alta" | "";
type KanbanColumn = { id: string; label: string; color: string; order: number; isDone?: boolean };

const priorityOptions: { value: Priority; label: string }[] = [
  { value: "", label: "Normal (sin prioridad)" },
  { value: "alta", label: "Alta" },
  { value: "urgencia", label: "🚨 URGENCIA" }
];

// Incluye "" → MEDIUM como mapping explícito para que TS pueda
// indexar el record con cualquier valor del tipo Priority sin
// guards en los call sites.
const priorityToApi: Record<Priority, string> = {
  "": "MEDIUM",
  alta: "HIGH",
  urgencia: "URGENT"
};

type CustomFieldDef = {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "multiselect" | "checkbox";
  required?: boolean;
  options?: string[];
  placeholder?: string;
  defaultValue?: any;
};
type TaskTemplate = {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  defaultProjectId: string | null;
  defaultStatus: string | null;
  defaultPriority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" | null;
  defaultAssigneeIds: string[] | null;
  defaultTags: string[] | null;
  defaultDueOffsetDays: number | null;
  bodyMarkdown: string | null;
  customFields: CustomFieldDef[] | null;
};

type CommentItem = {
  id: string;
  body: string;
  // bodyJson llega siempre desde /api/v1/tasks/[id]/comments (la API lo
  // calcula al vuelo si no existe en BD). Para comentarios importados
  // de Asana es donde vive el contenido rich con imágenes inline.
  bodyJson?: any;
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

  // Pila de navegación SUBTAREAS. La pila se rellena solo cuando el
  // user navega DENTRO del modal a una subtarea con goToSubtask().
  // Si está vacía, la tarea visible es directamente la prop `task`.
  //
  // Esto evita el bug que había antes (taskStack inicializado por
  // useEffect con la prop, creando un render intermedio donde
  // currentTask apuntaba a la tarea anterior, fuga de description
  // al editor rico, etc).
  const [subtaskStack, setSubtaskStack] = useState<CurrentTask[]>([]);
  const currentTask: CurrentTask | null =
    subtaskStack.length > 0
      ? subtaskStack[subtaskStack.length - 1]
      : (task as CurrentTask | null) ?? null;
  const isEdit = !!currentTask;

  // Form fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState<any>(null);
  const [status, setStatus] = useState<string>("TODO");
  const [priority, setPriority] = useState<Priority>(""); // default = normal (sin prioridad)
  // Multi-proyecto: la tarea puede estar en N proyectos. El primero del
  // array es el "principal" (define la columna kanban). projectIds[0]
  // siempre corresponde al projectId del schema.
  const [projectIds, setProjectIds] = useState<string[]>([]);
  // Columna seleccionada DENTRO de cada proyecto extra. Mapea
  // projectId → columnId. El proyecto principal usa el campo
  // "Estado" del modal.
  const [extraProjectStatuses, setExtraProjectStatuses] = useState<Record<string, string>>({});
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

  // Plantillas de task. Cargamos lista en mount. Si la task existente
  // tiene templateId, también cargamos esa plantilla concreta para
  // poder renderizar sus custom fields al editar.
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [customData, setCustomData] = useState<Record<string, any>>({});

  const [comments, setComments] = useState<CommentItem[]>([]);
  const [postingComment, setPostingComment] = useState(false);
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [savingForMeeting, setSavingForMeeting] = useState(false);
  // editorKey usa useState (no useRef) para garantizar que React
  // re-renderiza con la key nueva — un useRef.current++ NO triggea
  // render, y el RichTextEditor mantiene su buffer interno con el
  // contenido de la tarea anterior. Bug visto al abrir "Nueva tarea"
  // después de haber abierto una tarea con descripción larga.
  const [editorKey, setEditorKey] = useState(0);

  /**
   * Abre el grabador de reunión. Si estamos en modo "nueva tarea",
   * primero guarda la tarea para tener un id al que adjuntar el
   * resumen como comentario; el modal pasa entonces a modo edición
   * (se inserta en taskStack) y se abre el recorder.
   */
  async function openMeetingRecorder() {
    if (currentTask) {
      setMeetingOpen(true);
      return;
    }
    if (!title.trim()) return setError("Pon un título a la tarea antes de grabar la reunión");
    if (!projectId) return setError("Selecciona un proyecto antes de grabar la reunión");

    setSavingForMeeting(true);
    setError(null);
    try {
      const payload: any = {
        title: title.trim(),
        projectId,
        projectIds,
        // Columna seleccionada en cada proyecto extra (multi-proyecto).
        // Lo pasamos como objeto plano; el endpoint persiste en
        // TaskProject.status.
        extraProjectStatuses,
        status,
        // Si el user no marcó nada (priority === ""), priorityToApi
        // ya mapea a MEDIUM (la prioridad neutra de Prisma).
        priority: priorityToApi[priority],
        assigneeIds,
        notifyDueRules
      };
      const r = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        return setError(j.message || `Error ${r.status}`);
      }
      const created = await r.json();
      // Pasamos el modal a modo edición de la tarea recién creada
      // pushing al stack de subtareas.
      setSubtaskStack([{ id: created.id, ...created } as CurrentTask]);
      router.refresh();
      setMeetingOpen(true);
    } finally {
      setSavingForMeeting(false);
    }
  }

  const [subtasks, setSubtasks] = useState<{ id: string; title: string; status: string }[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);

  // Reset del subtaskStack al abrir / cerrar modal. Solo se usa
  // cuando el user navega a subtareas DENTRO del modal abierto.
  // Si el modal abre con task=null (nueva tarea) o task=X (editar X),
  // currentTask se deriva DIRECTAMENTE de la prop — sin pasar por
  // este state.
  useEffect(() => {
    if (!open) return;
    setSubtaskStack([]);
    setError(null);
    // Reset del editor cuando se abre el modal en modo "Nueva tarea"
    // (no hay task). Sin esto el RichTextEditor mantiene el buffer
    // interno de la tarea anterior.
    if (!task) {
      setTitle("");
      setDescription(null);
      setEditorKey((k) => k + 1);
      setStatus(defaultStatus ?? columns?.[0]?.id ?? "TODO");
      setPriority("");
      setProjectIds([defaultProjectId ?? projects[0]?.id ?? ""].filter(Boolean) as string[]);
      setExtraProjectStatuses({});
      setAssigneeIds([]);
      setDueDate("");
      setDueTime("");
      setNotifyDueRules(null);
      setComments([]);
      setSubtasks([]);
      setError(null);
      setSelectedTemplateId(null);
      setCustomData({});
    }
  }, [open, task, defaultStatus, defaultProjectId, projects, columns]);

  // Carga las plantillas del workspace al abrir el modal — son pocas
  // y la respuesta es ligera. Una vez cacheadas, el selector las
  // ofrece sin esperar.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/v1/task-templates")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        if (!cancelled) setTemplates(d.items ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Si estoy editando una task que tiene templateId + customData, los
  // cargo para poder pintar los campos personalizados en la UI.
  useEffect(() => {
    if (!currentTask) {
      setSelectedTemplateId(null);
      setCustomData({});
      return;
    }
    const tplId = (currentTask as any).templateId ?? null;
    const cd = (currentTask as any).customData ?? null;
    setSelectedTemplateId(typeof tplId === "string" ? tplId : null);
    setCustomData(cd && typeof cd === "object" ? cd : {});
  }, [currentTask]);

  /** Aplica una plantilla al formulario actual. Solo en modo "nueva". */
  function applyTemplate(tpl: TaskTemplate | null) {
    if (!tpl) {
      setSelectedTemplateId(null);
      return;
    }
    setSelectedTemplateId(tpl.id);
    if (tpl.defaultProjectId) {
      setProjectIds([tpl.defaultProjectId]);
    }
    if (tpl.defaultStatus) setStatus(tpl.defaultStatus);
    if (tpl.defaultPriority) {
      const map: Record<string, Priority> = {
        LOW: "",
        MEDIUM: "",
        HIGH: "alta",
        URGENT: "urgencia"
      };
      setPriority(map[tpl.defaultPriority] ?? "");
    }
    if (Array.isArray(tpl.defaultAssigneeIds) && tpl.defaultAssigneeIds.length > 0) {
      setAssigneeIds(tpl.defaultAssigneeIds);
    }
    if (typeof tpl.defaultDueOffsetDays === "number") {
      const d = new Date(Date.now() + tpl.defaultDueOffsetDays * 86400_000);
      setDueDate(d.toISOString().slice(0, 10));
    }
    if (tpl.bodyMarkdown) {
      // Cargamos como texto plano en el editor — el RichTextEditor
      // lo acepta como string y lo convierte a doc TipTap.
      setDescription(tpl.bodyMarkdown);
      setEditorKey((k) => k + 1);
    }
    // Inicializar customData con defaults de los campos
    const initial: Record<string, any> = {};
    for (const f of tpl.customFields ?? []) {
      if (f.defaultValue !== undefined) initial[f.id] = f.defaultValue;
    }
    setCustomData(initial);
  }

  /** Plantilla actualmente activa (para renderizar custom fields). */
  const activeTemplate: TaskTemplate | null = selectedTemplateId
    ? templates.find((t) => t.id === selectedTemplateId) ?? null
    : null;

  // Cuando cambia la tarea activa (apertura o navegación a subtarea), recarga datos.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setEditorKey((k) => k + 1);
    if (currentTask) {
      setTitle(currentTask.title);
      setStatus(String(currentTask.status));
      // currentTask.priority puede ser "urgencia", "alta" o cualquier
      // otra cosa (media/baja legacy). Solo distinguimos los tres
      // estados de UI: vacío (normal), Alta, URGENCIA.
      setPriority(
        currentTask.priority === "urgencia"
          ? "urgencia"
          : currentTask.priority === "alta"
            ? "alta"
            : ("" as Priority)
      );
      setProjectIds(
        Array.isArray((currentTask as any).projectIds) && (currentTask as any).projectIds.length > 0
          ? (currentTask as any).projectIds
          : [currentTask.projectId]
      );
      // Cargar las columnas elegidas para cada proyecto extra (si las
      // hay). El principal NO entra aquí, usa el `status` general.
      const eps = (currentTask as any).extraProjectStatuses as
        | Record<string, string | null>
        | undefined;
      if (eps) {
        const clean: Record<string, string> = {};
        for (const [pid, st] of Object.entries(eps)) {
          if (st) {
            clean[pid] = st;
          } else {
            // Tarea legacy compartida sin columna explícita (null en
            // BD): por defecto, primera columna del proyecto extra si
            // tiene kanban propio; si no, primera del workspace.
            const proj = projects.find((pp) => pp.id === pid) as any;
            const ownCols = proj?.kanbanColumns;
            if (Array.isArray(ownCols) && ownCols.length > 0) {
              clean[pid] = ownCols[0].id;
            } else if (Array.isArray(columns) && columns.length > 0) {
              clean[pid] = (columns[0] as any).id;
            }
          }
        }
        setExtraProjectStatuses(clean);
      } else {
        setExtraProjectStatuses({});
      }
      setAssigneeIds(currentTask.assigneeIds);
      setDueDate(currentTask.dueDate ?? "");
      setDueTime(currentTask.dueAllDay === false && currentTask.dueTime ? currentTask.dueTime : "");
      setNotifyDueRules(Array.isArray(currentTask.notifyDueRules) ? currentTask.notifyDueRules : null);
      // Fetch detalle: descripción + subtareas + comentarios + plantilla
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
          // Plantilla + valores custom — vienen del Task.templateId
          // y Task.customData persistidos. Si la plantilla todavía
          // existe en /api/v1/task-templates (lista cargada por
          // separado), el render dinámico la encuentra y pinta los
          // campos. Si fue borrada, se respeta customData en BD pero
          // no se renderiza el bloque.
          if (data.templateId) setSelectedTemplateId(data.templateId);
          if (data.customData && typeof data.customData === "object") {
            setCustomData(data.customData);
          }
        });
      fetch(`/api/v1/tasks/${currentTask.id}/comments`)
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d) => setComments(d.items ?? []));
    } else {
      setTitle("");
      setDescription(null);
      setStatus(defaultStatus ?? columns?.[0]?.id ?? "TODO");
      setPriority(""); // sin prioridad por defecto al crear nueva
      setProjectIds([defaultProjectId ?? projects[0]?.id ?? ""].filter(Boolean) as string[]);
      setExtraProjectStatuses({});
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
      // CRÍTICO: la columna seleccionada para cada proyecto extra
      // va EN ESTE campo. Sin esto, el PATCH/POST no la persiste y
      // todas las tareas compartidas caen siempre en la primera
      // columna del kanban del proyecto extra (típicamente "TAREAS
      // URGENTES" o equivalente). Antes solo se enviaba en el flujo
      // de "Grabar reunión rápida" — el flow normal de guardado lo
      // omitía y el bug pasaba desapercibido.
      extraProjectStatuses,
      status,
      priority: priorityToApi[priority],
      assigneeIds,
      description: descSerialized,
      notifyDueRules,
      // Plantilla + valores de campos personalizados. null si el
      // usuario no eligió plantilla, o si la quitó (volver a "en
      // blanco") tras seleccionarla.
      templateId: selectedTemplateId || null,
      customData:
        selectedTemplateId && Object.keys(customData).length > 0 ? customData : null
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
    if (subtaskStack.length === 0) {
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
    if (subtaskStack.length === 0) onClose();
    else goBack();
  }

  // Lanza a Sonia AHORA — bypass del cron y del dedupe de "comparte
  // con buzón". Si ya hay un run pendiente/en marcha, el endpoint
  // devuelve el existente sin duplicar.
  const [sendingToSonia, setSendingToSonia] = useState(false);
  async function sendToSonia() {
    if (!currentTask) return;
    setSendingToSonia(true);
    setError(null);
    try {
      // Inline=0 → encola en PENDING (rápido, no bloquea UI). El cron
      // lo procesa en 1-2 min; mientras tanto la tarjeta parpadea morado.
      const r = await fetch(`/api/v1/tasks/${currentTask.id}/ai-process?inline=0`, {
        method: "POST"
      });
      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.ok) {
        setError(data?.error || data?.message || `Sonia: HTTP ${r.status}`);
        return;
      }
      if (data.deduped) {
        setError(`Sonia ya está trabajando en esta tarea (run ${data.runId}, ${data.status}). Si está perdida o llevando demasiado, pulsa "🛠 Claude" para mandármela.`);
      } else {
        setError(`✓ Enviada a Sonia. Se procesará en breve (run ${data.runId}).`);
      }
    } catch (e: any) {
      setError(`Sonia: ${e?.message ?? e}`);
    } finally {
      setSendingToSonia(false);
    }
  }

  // Force-retry: mata cualquier run PENDING/RUNNING y arranca otro.
  // Escalación manual a Claude Code: cuando el user ve que Sonia
  // no lo está haciendo bien, lo entrega pobre, está perdida o
  // tarda demasiado, puede mandarme la tarea a mí (Claude) para
  // que la analice. Yo decido si arreglar el código del runner,
  // añadir tool nueva, o darle a Sonia instrucciones más claras.
  async function askClaude() {
    if (!currentTask) return;
    const reason = prompt(
      `¿Por qué le pides ayuda a Claude? (opcional pero útil)\n\nEj: "Sonia me ha entregado un Excel feo sin formato" / "Lleva 10 min y no responde" / "No ha hecho lo que pedí".`,
      ""
    );
    if (reason === null) return; // canceló
    setSendingToSonia(true);
    setError(null);
    try {
      const r = await fetch(`/api/v1/tasks/${currentTask.id}/ai-escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() })
      });
      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.ok) {
        setError(data?.error || data?.message || `Escalación: HTTP ${r.status}`);
        return;
      }
      setError(
        `🛠 Claude está investigando esta tarea${
          data.aborted > 0 ? ` (abortado ${data.aborted} run de Sonia en curso)` : ""
        }. Recibirás notificación cuando aplique la mejora.`
      );
    } catch (e: any) {
      setError(`Escalación: ${e?.message ?? e}`);
    } finally {
      setSendingToSonia(false);
    }
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
      // Mapeo BD → UI: solo distinguimos URGENT y HIGH; el resto
      // (MEDIUM, LOW) se trata como "normal" (sin prioridad visible).
      priority: data.priority === "URGENT" ? "urgencia" : data.priority === "HIGH" ? "alta" : "media",
      tags: (data.tags ?? []).map((t: any) => t.tag?.name ?? "").filter(Boolean),
      _parentId: data.parentId ?? null
    };
    setSubtaskStack((s) => [...s, sub]);
  }

  function goBack() {
    setSubtaskStack((s) => s.slice(0, -1));
  }

  // parentInStack — la "tarea padre" cuando estamos navegando una
  // subtarea dentro del modal. Si subtaskStack.length === 1, el
  // padre es la prop `task`. Si hay más niveles, el padre es el
  // elemento previo de la pila.
  const parentInStack: CurrentTask | null =
    subtaskStack.length === 1
      ? ((task as CurrentTask | null) ?? null)
      : subtaskStack.length > 1
        ? subtaskStack[subtaskStack.length - 2]
        : null;
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
          {isEdit && (
            <button
              type="button"
              onClick={sendToSonia}
              disabled={sendingToSonia || saving}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 font-medium disabled:opacity-50"
              title="Encola un run de Sonia para esta tarea (sin esperar a que la enlaces al proyecto buzón)"
            >
              {sendingToSonia ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
              Pedir a Sonia
            </button>
          )}
          {isEdit && (
            <button
              type="button"
              onClick={askClaude}
              disabled={sendingToSonia || saving}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-sky-300 bg-sky-50 hover:bg-sky-100 text-sky-800 font-semibold disabled:opacity-50"
              title="Manda esta tarea a Claude Code (el desarrollador de Sonia). Úsalo cuando Sonia esté perdida, entregue algo pobre o lleve demasiado rato. Claude analiza la tarea entera, aplica una mejora al sistema o da instrucciones a Sonia, y re-procesa la tarea automáticamente."
            >
              🛠 Claude
            </button>
          )}
          <button
            type="button"
            onClick={openMeetingRecorder}
            disabled={saving || savingForMeeting}
            className={
              "inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-medium disabled:opacity-50 " +
              (isEdit ? "" : "mr-auto")
            }
            title={
              isEdit
                ? "Graba la reunión y la IA añadirá un resumen como comentario"
                : "Guarda la tarea y abre el grabador. El resumen llegará como comentario."
            }
          >
            {savingForMeeting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            Grabar reunión
          </button>
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
          {/* Selector de plantilla — solo en modo "Nueva tarea".
              SIEMPRE visible (con plantillas o sin ellas) para que el
              user descubra dónde gestionarlas. Cuando no hay plantillas
              creadas todavía, en lugar del selector mostramos un CTA
              para crear la primera. */}
          {!isEdit && (
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-2 flex items-center gap-2 text-xs flex-wrap">
              <span className="text-violet-700 font-medium shrink-0">✨ Plantilla:</span>
              {templates.length > 0 ? (
                <select
                  value={selectedTemplateId ?? ""}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) {
                      setSelectedTemplateId(null);
                      setCustomData({});
                      return;
                    }
                    const tpl = templates.find((t) => t.id === id);
                    if (tpl) applyTemplate(tpl);
                  }}
                  className="flex-1 bg-white rounded-md border border-violet-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400"
                >
                  <option value="">— sin plantilla (en blanco) —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.icon ? `${t.icon} ` : ""}
                      {t.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="flex-1 text-violet-700 text-[11px]">
                  Aún no hay plantillas. Crea la primera para prerellenar
                  campos automáticamente.
                </span>
              )}
              <a
                href="/admin/task-templates"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-violet-700 hover:text-violet-900 hover:bg-white px-2 py-1 rounded shrink-0"
                title="Abrir el gestor de plantillas en otra pestaña"
              >
                ⚙ Gestionar plantillas →
              </a>
            </div>
          )}

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            className="w-full text-lg font-semibold px-0 py-1 bg-transparent border-0 border-b border-transparent focus:border-brand-500 focus:outline-none focus:ring-0"
            placeholder="Título de la tarea…"
          />
          {isEdit && currentTask?.id && (
            <button
              type="button"
              title="Copiar ID de la tarea (para soporte / debug)"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(currentTask.id);
                } catch {}
              }}
              className="text-[10px] font-mono text-slate-400 hover:text-slate-600 -mt-2"
            >
              ID: {currentTask.id} <span className="ml-1">📋</span>
            </button>
          )}

          <div>
            <div className="text-xs font-medium text-slate-700 mb-1">Descripción</div>
            <div className="border rounded-lg p-3 bg-white">
              <RichTextEditor
                key={editorKey}
                initialContent={description}
                onChange={setDescription}
                placeholder="Describe la tarea… / para bloques, @ para mencionar."
                minHeight={140}
                mentionCandidates={mentionCandidates}
              />
            </div>
          </div>

          {/* Campos personalizados de la plantilla. Render dinámico
              según el schema definido al crear la plantilla. */}
          {activeTemplate && Array.isArray(activeTemplate.customFields) && activeTemplate.customFields.length > 0 && (
            <div className="border rounded-lg p-3 bg-violet-50/40 border-violet-200">
              <div className="text-xs font-medium text-violet-900 mb-3 flex items-center gap-1.5">
                ✨ Campos de la plantilla "{activeTemplate.name}"
              </div>
              <div className="space-y-3">
                {activeTemplate.customFields.map((f) => (
                  <CustomFieldInput
                    key={f.id}
                    field={f}
                    value={customData[f.id]}
                    onChange={(v) =>
                      setCustomData((prev) => ({ ...prev, [f.id]: v }))
                    }
                  />
                ))}
              </div>
            </div>
          )}

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
                <ReimportCommentsButton
                  taskId={currentTask!.id}
                  onDone={() => {
                    // Re-fetch de comentarios tras la re-importación.
                    fetch(`/api/v1/tasks/${currentTask!.id}/comments`)
                      .then((r) => (r.ok ? r.json() : { items: [] }))
                      .then((d) => setComments(d.items ?? []));
                    // El botón también re-importa los attachments del
                    // task (xps, pdf, txt sueltos). Avisamos al
                    // AttachmentList para que se refresque sin tener
                    // que cerrar y reabrir el modal.
                    window.dispatchEvent(
                      new CustomEvent("attachments-changed", {
                        detail: { targetType: "TASK", targetId: currentTask!.id }
                      })
                    );
                  }}
                />
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
                        <CommentRenderer body={c.body} bodyJson={c.bodyJson} />
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
            <div className="space-y-1 max-h-60 overflow-y-auto -mx-1 px-1">
              {projects.map((p) => {
                const sel = projectIds.includes(p.id);
                const isPrimary = projectIds[0] === p.id;
                // Columnas efectivas para el proyecto extra: si tiene
                // kanban propio (importado de Asana o configurado a
                // mano), lo usamos. Si no, caemos al kanban del
                // workspace — antes no había dropdown en ese caso y
                // el user no podía elegir columna para la tarea
                // compartida → siempre acababa en la primera.
                const ownCols = ((p as any).kanbanColumns ?? null) as
                  | { id: string; label: string }[]
                  | null;
                const effectiveCols =
                  ownCols && ownCols.length > 0
                    ? ownCols
                    : (columns as { id: string; label: string }[] | undefined) ?? [];
                return (
                  <div key={p.id}>
                    <label
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
                            if (projectIds.length === 1) return;
                            setProjectIds(projectIds.filter((x) => x !== p.id));
                            setExtraProjectStatuses((prev) => {
                              const next = { ...prev };
                              delete next[p.id];
                              return next;
                            });
                          } else {
                            setProjectIds([...projectIds, p.id]);
                            // CRÍTICO: inicializa el status con la primera
                            // columna efectiva del proyecto recién añadido.
                            // Sin esto el <select> mostraba la primera
                            // columna pero el state quedaba undefined → al
                            // submit se enviaba null → la tarea acababa en
                            // la primera columna del kanban, no en la que
                            // el user pensaba.
                            if (effectiveCols.length > 0) {
                              setExtraProjectStatuses((prev) => ({
                                ...prev,
                                [p.id]: prev[p.id] ?? effectiveCols[0].id
                              }));
                            }
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
                    {/* Selector de columna para los proyectos extra.
                        Si el proyecto tiene kanban propio (custom o
                        importado de Asana) usa esas columnas; si no,
                        usa las del workspace. El principal usa el
                        campo "Estado" general arriba. */}
                    {sel && !isPrimary && effectiveCols.length > 0 && (
                      <div className="ml-7 mb-1 mt-0.5">
                        <select
                          value={extraProjectStatuses[p.id] ?? effectiveCols[0].id}
                          onChange={(e) =>
                            setExtraProjectStatuses((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                          className="w-full px-2 py-1 rounded border bg-white text-[11px] focus:outline-none"
                          title={`En qué columna aparece dentro de "${p.name}"`}
                        >
                          {effectiveCols.map((c) => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                          ))}
                        </select>
                        {!ownCols && (
                          <div className="text-[9px] text-slate-400 mt-0.5">
                            Sin kanban propio · columnas del workspace
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {projectIds.length > 1 && (
              <p className="mt-1 text-[10px] text-slate-500">
                La tarea aparece en los {projectIds.length} proyectos. El "principal" define en qué tablero kanban se mueve por defecto; en los extra eliges columna con el selector.
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
      {currentTask && (
        <MeetingRecorder
          taskId={currentTask.id}
          open={meetingOpen}
          onClose={() => setMeetingOpen(false)}
          onComment={(c) => setComments((prev) => [...prev, c])}
        />
      )}
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


/**
 * Botón pequeño "Re-importar comentarios" — solo visible para admins
 * en tareas que vienen de Asana. Llama a
 * /api/v1/admin/asana/reimport-task-comments?localTaskId=... y
 * muestra un mini-informe (created/updated/skipped/errors). Útil
 * para recuperar comentarios de tareas concretas sin volver a
 * re-importar todo el workspace.
 */
function ReimportCommentsButton({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setReport(null);
    try {
      const r = await fetch(
        `/api/v1/admin/asana/reimport-task-comments?localTaskId=${encodeURIComponent(taskId)}`,
        { method: "POST" }
      );
      const j = await r.json();
      if (!r.ok) {
        setReport(`✗ ${j?.error?.message ?? `Error ${r.status}`}`);
        return;
      }
      const parts: string[] = [];
      if (j.created > 0) parts.push(`✓ ${j.created} comentarios nuevos`);
      if (j.updated > 0) parts.push(`↻ ${j.updated} actualizados`);
      if (j.skipped > 0) parts.push(`· ${j.skipped} sin cambios`);
      if (j.errors > 0) parts.push(`✗ ${j.errors} errores`);
      if (j.storiesFound === 0) parts.push("(Asana no devolvió ningún comentario para esta tarea)");
      // Task-level attachments (xps, txt, pdf sueltos) — aparecen en
      // la sección "Adjuntos" del modal, no dentro de comentarios.
      if (j.taskAttachments?.imported > 0)
        parts.push(`📎 ${j.taskAttachments.imported} adjuntos nuevos`);
      if (j.taskAttachments?.externalLinked > 0)
        parts.push(`🔗 ${j.taskAttachments.externalLinked} externos`);
      setReport(parts.join(" · ") || "Sin novedades");
      onDone();
    } catch (e: any) {
      setReport(`✗ ${e?.message ?? "Error de red"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ml-auto flex items-center gap-2">
      {report && <span className="text-[10px] text-slate-500">{report}</span>}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title="Vuelve a importar los comentarios de esta tarea desde Asana (solo admin)"
        className="inline-flex items-center gap-1 text-[10px] text-brand-600 hover:text-brand-700 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        Re-importar de Asana
      </button>
    </div>
  );
}

/**
 * Render dinámico de un custom field según su type.
 */
function CustomFieldInput({
  field,
  value,
  onChange
}: {
  field: CustomFieldDef;
  value: any;
  onChange: (v: any) => void;
}) {
  const label = (
    <label className="text-xs font-medium text-slate-700 block mb-1">
      {field.label}
      {field.required && <span className="text-rose-500 ml-0.5">*</span>}
    </label>
  );
  const base =
    "w-full rounded-lg border border-slate-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";
  switch (field.type) {
    case "text":
      return (
        <div>
          {label}
          <input
            type="text"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            className={base}
          />
        </div>
      );
    case "textarea":
      return (
        <div>
          {label}
          <textarea
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            rows={3}
            className={base}
          />
        </div>
      );
    case "number":
      return (
        <div>
          {label}
          <input
            type="number"
            value={value ?? ""}
            onChange={(e) =>
              onChange(e.target.value === "" ? null : Number(e.target.value))
            }
            placeholder={field.placeholder}
            className={base}
          />
        </div>
      );
    case "date":
      return (
        <div>
          {label}
          <input
            type="date"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className={base}
          />
        </div>
      );
    case "select":
      return (
        <div>
          {label}
          <select
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className={base}
          >
            <option value="">— elige —</option>
            {(field.options ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      );
    case "multiselect": {
      const arr: string[] = Array.isArray(value) ? value : [];
      return (
        <div>
          {label}
          <div className="flex flex-wrap gap-1.5">
            {(field.options ?? []).map((opt) => {
              const sel = arr.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() =>
                    onChange(sel ? arr.filter((x) => x !== opt) : [...arr, opt])
                  }
                  className={
                    "px-2 py-0.5 rounded-md text-xs " +
                    (sel
                      ? "bg-brand-100 text-brand-700"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200")
                  }
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    case "checkbox":
      return (
        <div>
          <label className="text-sm inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => onChange(e.target.checked)}
            />
            <span className="text-slate-700">
              {field.label}
              {field.required && <span className="text-rose-500 ml-0.5">*</span>}
            </span>
          </label>
        </div>
      );
  }
}
