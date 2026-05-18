"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import PageHeader from "@/components/PageHeader";
import AvatarStack from "@/components/AvatarStack";
import TaskFormModal from "@/components/forms/TaskFormModal";
import ProjectFormModal from "@/components/forms/ProjectFormModal";
import BulkActionBar from "@/components/tareas/BulkActionBar";
import MobileFABs from "@/components/tareas/MobileFABs";
import VoiceTaskRecorder from "@/components/forms/VoiceTaskRecorder";
import MeetingRecorder from "@/components/forms/MeetingRecorder";
import { statusLabelOf, statusColorOf, priorityColors, priorityLabels } from "@/lib/mock-data";
import type { UiTask, UiProject, UiClient, UiMember } from "@/lib/db/queries";
import { LayoutGrid, List, Plus, Filter, CalendarDays, FolderPlus, GripVertical, CheckSquare, Square, Settings2, Loader2, Link2, Check } from "lucide-react";
import clsx from "clsx";
import SavedFiltersBar, { DEFAULT_FILTERS, type TaskFilters } from "@/components/tareas/SavedFiltersBar";
import { useSession } from "next-auth/react";

type KanbanColumn = { id: string; label: string; color: string; order: number; isDone?: boolean };

/** Estado del último AiAgentRun para una task, tal y como llega de
 * /api/v1/tasks/ai-status. Se propaga a TaskCard para pintar borde
 * de color + badge informativo. */
type AiStatusInfo = {
  /**
   * Estado visual para la card:
   *   working          → morado, Sonia trabajando
   *   ai_replied       → CYAN BRILLANTE PARPADEANTE, Sonia te ha
   *                      contestado y no lo has visto aún (gana
   *                      sobre todo lo demás cuando aplica)
   *   done_unreviewed  → verde, Sonia terminó, espera revisión humana
   *   needs_help       → naranja, Sonia paró y necesita HUMANO
   *   claude_working   → azul, Sonia escaló y Claude (otro agente)
   *                      está mejorando el sistema; el user no
   *                      tiene que hacer nada
   */
  aiStatus:
    | "working"
    | "ai_replied"
    | "done_unreviewed"
    | "needs_help"
    | "claude_working"
    | null;
  runId?: string;
  runStatus?: string;
  startedAt?: string;
  finishedAt?: string | null;
  summary?: string | null;
  error?: string | null;
  stepsCount?: number;
  reviewed?: boolean;
  /** Si hay escalación a Claude, URL del issue en GitHub. */
  escalationIssueUrl?: string | null;
  escalationIssueNumber?: number | null;
  /** Texto humano de qué está haciendo Sonia AHORA mismo. */
  lastStepText?: string | null;
  /** Nombre técnico de la última tool ejecutada. */
  lastToolName?: string | null;
  /** Cuándo Sonia añadió su último comentario en la task. */
  lastAiCommentAt?: string | null;
  /** Primeros 140 chars del último comentario de Sonia. */
  lastAiCommentPreview?: string | null;
};

const COLUMN_ORDER_KEY = "kanban-column-order-v2";

// Presets de color para columnas. Usados también en ColumnHeaderMenu
// para que el usuario pueda recolorear la columna en línea.
export const COLUMN_COLOR_PRESETS: { label: string; value: string }[] = [
  { label: "Gris", value: "bg-slate-100 text-slate-700 border-slate-200" },
  { label: "Azul", value: "bg-sky-100 text-sky-800 border-sky-300" },
  { label: "Índigo", value: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  { label: "Ámbar", value: "bg-amber-100 text-amber-800 border-amber-300" },
  { label: "Verde", value: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  { label: "Rosa", value: "bg-rose-100 text-rose-800 border-rose-300" },
  { label: "Violeta", value: "bg-violet-100 text-violet-800 border-violet-300" },
  // Tonos intensos para columnas críticas (urgencias, bloqueos, etc.).
  { label: "Rojo intenso", value: "bg-rose-600 text-white border-rose-700" },
  { label: "Naranja intenso", value: "bg-orange-500 text-white border-orange-700" },
  { label: "Verde intenso", value: "bg-emerald-600 text-white border-emerald-700" },
  { label: "Negro", value: "bg-slate-900 text-white border-slate-900" }
];

const FALLBACK_COLUMNS: KanbanColumn[] = [
  { id: "TODO", label: "Por hacer", color: "bg-slate-100 text-slate-700 border-slate-200", order: 0 },
  { id: "IN_PROGRESS", label: "En curso", color: "bg-sky-100 text-sky-800 border-sky-300", order: 1 },
  { id: "REVIEW", label: "Revisión", color: "bg-amber-100 text-amber-800 border-amber-300", order: 2 },
  { id: "DONE", label: "Hecha", color: "bg-emerald-100 text-emerald-800 border-emerald-300", order: 3, isDone: true }
];

export default function TareasClient({
  tasks: initialTasks,
  projects,
  clients,
  team
}: {
  tasks: UiTask[];
  projects: UiProject[];
  clients: UiClient[];
  team: UiMember[];
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlProject = searchParams.get("project");
  const { data: session } = useSession();
  const myUserId = (session?.user as any)?.id as string | undefined;
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [isMobile, setIsMobile] = useState(false);
  // En móvil mantenemos kanban (no list) — estilo Asana, una columna
  // ancha visible con la siguiente asomando. Mucho más cómodo de
  // navegar con el pulgar que una tabla.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const [filters, setFilters] = useState<TaskFilters>({
    ...DEFAULT_FILTERS,
    project: urlProject ?? "all"
  });
  // Compat con código previo que usaba projectFilter — derivado.
  const projectFilter = filters.project;
  const setProjectFilter = (p: string) => setFilters((f) => ({ ...f, project: p }));

  const [tasks, setTasks] = useState<UiTask[]>(initialTasks);
  useEffect(() => setTasks(initialTasks), [initialTasks]);

  // Sonia — estado visual + datos enriquecidos por task. Polling
  // ADAPTATIVO: si hay tasks "activas" (Sonia trabajando, lista
  // sin revisar, o pide ayuda) → cada 4s; si no → cada 20s. Así el
  // morado aparece casi al instante cuando arrancas un run, y el
  // gasto de polling baja cuando no hay nada activo.
  const [aiStatusByTask, setAiStatusByTask] = useState<Record<string, AiStatusInfo>>({});
  // Diagnóstico visible — para que el user vea si el polling está
  // vivo y qué responde el endpoint. Sin esto el bug "no veo el
  // morado" es invisible: la card no parpadea y no sé si es porque
  // (a) el run terminó rápido (b) el polling falla (c) el render
  // no aplica el estilo. Con este panel veo (a) y (b) directamente.
  const [aiDebug, setAiDebug] = useState<{
    lastPollAt: number | null;
    lastPollOk: boolean;
    lastPollError: string | null;
    activeCount: number;
    pollCount: number;
  }>({ lastPollAt: null, lastPollOk: false, lastPollError: null, activeCount: 0, pollCount: 0 });
  // Ref para que poll() lea el state actual sin reinstalar el interval
  // cada vez que cambia. Sin esto, cambiar deps del useEffect mata y
  // reabre el interval — perdíamos el ritmo.
  const aiStatusRef = useRef<Record<string, AiStatusInfo>>({});
  useEffect(() => {
    aiStatusRef.current = aiStatusByTask;
  }, [aiStatusByTask]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function pollOnce() {
      if (tasks.length === 0) {
        setAiDebug((d) => ({ ...d, lastPollAt: Date.now(), lastPollError: "tasks.length===0", pollCount: d.pollCount + 1 }));
        return;
      }
      // POST con body en lugar de GET con querystring — el edge de
      // Railway devuelve HTTP 431 ("Request Header Fields Too
      // Large") cuando la URL excede ~8KB. Con workspaces que tienen
      // muchas tareas (2100 de un import de Asana), 200+ IDs ya
      // disparan el error y el polling no devolvía nada.
      const idArray = tasks.slice(0, 1000).map((t) => t.id);
      try {
        const r = await fetch(`/api/v1/tasks/ai-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskIds: idArray }),
          cache: "no-store"
        });
        if (!r.ok) {
          const errMsg = `HTTP ${r.status}`;
          console.warn(`[ai-status] ${errMsg} — el indicador de Sonia no se pintará`);
          setAiDebug((d) => ({ ...d, lastPollAt: Date.now(), lastPollOk: false, lastPollError: errMsg, pollCount: d.pollCount + 1 }));
          return;
        }
        const data = await r.json();
        if (cancelled) return;
        const next: Record<string, AiStatusInfo> = {};
        for (const it of data.items ?? []) {
          if (it.aiStatus) {
            next[it.taskId] = {
              aiStatus: it.aiStatus,
              runId: it.runId,
              runStatus: it.runStatus,
              startedAt: it.startedAt,
              finishedAt: it.finishedAt,
              summary: it.summary,
              error: it.error,
              stepsCount: it.stepsCount,
              reviewed: it.reviewed,
              escalationIssueUrl: it.escalationIssueUrl,
              escalationIssueNumber: it.escalationIssueNumber,
              lastStepText: it.lastStepText,
              lastToolName: it.lastToolName,
              lastAiCommentAt: it.lastAiCommentAt,
              lastAiCommentPreview: it.lastAiCommentPreview
            };
          }
        }
        const activeCount = Object.keys(next).length;
        if (activeCount > 0) {
          console.log(`[ai-status] ${activeCount} task(s) con estado activo:`, next);
        }
        setAiStatusByTask(next);
        setAiDebug((d) => ({
          lastPollAt: Date.now(),
          lastPollOk: true,
          lastPollError: null,
          activeCount,
          pollCount: d.pollCount + 1
        }));
      } catch (e: any) {
        const errMsg = String(e?.message ?? e);
        console.warn("[ai-status] fetch error:", e);
        setAiDebug((d) => ({ ...d, lastPollAt: Date.now(), lastPollOk: false, lastPollError: errMsg, pollCount: d.pollCount + 1 }));
      }
    }

    function scheduleNext() {
      if (cancelled) return;
      // Adaptativo: si alguna task tiene aiStatus activo (working /
      // done_unreviewed / needs_help), polling rápido; si no, lento.
      const hasActive = Object.values(aiStatusRef.current).some(
        (s) => s && s.aiStatus !== null
      );
      const delay = hasActive ? 4000 : 20000;
      timer = setTimeout(async () => {
        await pollOnce();
        scheduleNext();
      }, delay);
    }

    // Primer poll inmediato, luego loop adaptativo.
    pollOnce().then(() => scheduleNext());

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [tasks.length]);

  // Marcar runs como revisados (apaga el verde) — handler compartido
  // por todas las cards, pasado en context-like prop drilling.
  async function markAiReviewed(taskId: string) {
    try {
      await fetch(`/api/v1/tasks/${taskId}/ai-mark-reviewed`, { method: "POST" });
      setAiStatusByTask((prev) => {
        const cur = prev[taskId];
        if (!cur) return prev;
        return { ...prev, [taskId]: { ...cur, aiStatus: null, reviewed: true } };
      });
    } catch {}
  }

  const [workspaceColumns, setWorkspaceColumns] = useState<KanbanColumn[]>(FALLBACK_COLUMNS);
  const [columnsLoaded, setColumnsLoaded] = useState(false);
  const [userColumnOrder, setUserColumnOrder] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/v1/kanban-columns")
      .then((r) => (r.ok ? r.json() : { items: FALLBACK_COLUMNS }))
      .then((d) => {
        setWorkspaceColumns(d.items ?? FALLBACK_COLUMNS);
        setColumnsLoaded(true);
      });
    try {
      const saved = localStorage.getItem(COLUMN_ORDER_KEY);
      if (saved) setUserColumnOrder(JSON.parse(saved));
    } catch {}
  }, []);

  // Columnas efectivas: si hay un proyecto filtrado y ese proyecto
  // tiene columnas propias (project.kanbanColumns), usamos esas
  // (importadas de Asana o configuradas a mano). Si no, las del
  // workspace. Esto es lo que hace que cada proyecto tenga su
  // propio tablero — equivalente a Asana.
  const columns: KanbanColumn[] = useMemo(() => {
    if (filters.project !== "all") {
      const proj = projects.find((p) => p.id === filters.project) as any;
      const pc = proj?.kanbanColumns;
      if (Array.isArray(pc) && pc.length > 0) {
        return pc as KanbanColumn[];
      }
    }
    return workspaceColumns;
  }, [filters.project, projects, workspaceColumns]);

  // Endpoint correcto al que mandar cambios de columnas: si estamos
  // viendo un proyecto concreto, las ediciones son DE ESE PROYECTO
  // (no del workspace global). Si estamos en "todos los proyectos",
  // editamos el global del workspace. FIX del bug de "cambio columna
  // en proyecto X y se cambia en proyecto Y" — antes todo iba al
  // global del workspace independientemente del filtro.
  const columnsEndpoint =
    filters.project !== "all"
      ? `/api/v1/projects/${filters.project}/kanban-columns`
      : "/api/v1/kanban-columns";

  // Compat con código previo
  const setColumns = setWorkspaceColumns;

  useEffect(() => setFilters((f) => ({ ...f, project: urlProject ?? "all" })), [urlProject]);

  // Aplicar el orden custom guardado en localStorage por usuario
  const orderedColumns = useMemo(() => {
    if (userColumnOrder.length === 0) return [...columns].sort((a, b) => a.order - b.order);
    const known = new Map(columns.map((c) => [c.id, c]));
    const ordered: KanbanColumn[] = [];
    for (const id of userColumnOrder) {
      const c = known.get(id);
      if (c) {
        ordered.push(c);
        known.delete(id);
      }
    }
    for (const c of known.values()) ordered.push(c);
    return ordered;
  }, [columns, userColumnOrder]);

  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskStatus, setNewTaskStatus] = useState<string | undefined>();
  const [editingTask, setEditingTask] = useState<UiTask | null>(null);

  // Deep-link: si la URL trae ?task=ID, abrimos automáticamente esa
  // tarea al cargar. Permite que copies/pegues la URL desde el botón
  // de Link2 y al abrirla salte directo a la tarea.
  useEffect(() => {
    const taskId = searchParams.get("task");
    if (!taskId) return;
    const t = tasks.find((x) => x.id === taskId);
    if (t) {
      setEditingTask(t);
      setNewTaskOpen(true);
    }
    // Si no la encontramos (todavía no han cargado), no insistimos —
    // el efecto se reejecuta cuando `tasks` se actualiza.
  }, [searchParams, tasks]);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // Estados para los FABs mobile: grabador de voz para crear tarea
  // (Whisper + Claude maquetan), grabador de reunión rápida (crea
  // tarea auto-titulada y abre el grabador en un solo click).
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [quickMeetingTaskId, setQuickMeetingTaskId] = useState<string | null>(null);
  const [quickMeetingError, setQuickMeetingError] = useState<string | null>(null);
  const [creatingQuickMeeting, setCreatingQuickMeeting] = useState(false);

  async function handleQuickMeeting() {
    if (creatingQuickMeeting) return;
    // Si no hay proyecto filtrado, usamos el primero disponible. Si no
    // hay ninguno, avisamos al user — sin proyecto la tarea no se
    // puede crear.
    const targetProject = projectFilter !== "all" ? projectFilter : projects[0]?.id;
    if (!targetProject) {
      setQuickMeetingError("Crea un proyecto antes de grabar una reunión");
      return;
    }
    setCreatingQuickMeeting(true);
    setQuickMeetingError(null);
    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const title = `Reunión ${pad(now.getDate())}/${pad(now.getMonth() + 1)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const r = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          projectId: targetProject,
          status: orderedColumns[0]?.id ?? "TODO",
          priority: "MEDIUM"
        })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.message || `Error ${r.status}`);
      }
      const created = await r.json();
      setQuickMeetingTaskId(created.id);
      router.refresh();
    } catch (e: any) {
      setQuickMeetingError(e?.message ?? "No se pudo crear la tarea");
    } finally {
      setCreatingQuickMeeting(false);
    }
  }

  function handleTaskByText() {
    openNewTask();
  }

  function handleTaskByVoice() {
    setVoiceOpen(true);
  }

  // Selección masiva
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
    setSelectionMode(false);
  }

  const filtered = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const q = filters.q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (filters.project !== "all") {
        // Multi-proyecto: la tarea aparece si su proyecto principal
        // coincide O si está enlazada como extra (t.projectIds[0] es
        // el principal y trae también los extras).
        const allProjs = (t as any).projectIds ?? [t.projectId];
        if (!allProjs.includes(filters.project)) return false;
      }
      if (filters.client !== "all" && t.clientId !== filters.client) return false;
      if (filters.priority !== "all") {
        // "normal" agrupa todo lo que no sea alta ni urgencia (media,
        // baja, "" o cualquier legacy). Para urgencia / alta exactos
        // hacemos comparación directa.
        const isAltaUrgencia = t.priority === "alta" || t.priority === "urgencia";
        if (filters.priority === "normal") {
          if (isAltaUrgencia) return false;
        } else if (String(t.priority) !== filters.priority) {
          return false;
        }
      }
      if (filters.status !== "all" && String(t.status) !== filters.status) return false;
      if (filters.assignee === "me") {
        if (!myUserId || !t.assigneeIds?.includes(myUserId)) return false;
      } else if (filters.assignee === "none") {
        if (t.assigneeIds && t.assigneeIds.length > 0) return false;
      } else if (filters.assignee !== "all") {
        if (!t.assigneeIds?.includes(filters.assignee)) return false;
      }
      if (filters.due !== "all") {
        if (filters.due === "no-date") {
          if (t.dueDate) return false;
        } else {
          if (!t.dueDate) return false;
          const d = new Date(t.dueDate);
          d.setHours(0, 0, 0, 0);
          if (filters.due === "overdue" && d >= today) return false;
          if (filters.due === "today" && d.getTime() !== today.getTime()) return false;
          if (filters.due === "week" && (d < today || d > weekEnd)) return false;
        }
      }
      // Defensa: alguna tarea importada de Asana podría tener title
      // vacío o null tras una eliminación parcial. No rompemos el
      // filtro entero por eso.
      if (q && !(t.title ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, filters, myUserId]);
  const getClient = (id?: string) => clients.find((c) => c.id === id);
  const getProject = (id?: string) => projects.find((p) => p.id === id);

  function openNewTask(status?: string) {
    if (selectionMode) return; // no abrir modal durante selección
    setNewTaskStatus(status);
    setEditingTask(null);
    setNewTaskOpen(true);
  }
  function openEditTask(task: UiTask) {
    if (selectionMode) {
      toggleSelected(task.id);
      return;
    }
    setEditingTask(task);
    setNewTaskStatus(undefined);
    setNewTaskOpen(true);
  }

  // Sensores separados desktop/mobile:
  //   - Mouse: arrastra al mover 8px (no hace falta mantener pulsado).
  //   - Touch: long-press (250ms) con tolerancia de 8px antes de
  //     activar drag. Sin esto el scroll vertical de la columna
  //     pelea con dnd-kit y nada se mueve en mobile.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );

  // Estrategia de detección de colisión híbrida — closestCorners
  // funciona mal con touch + DragOverlay (a veces over=null al
  // soltar, la tarea no se queda). Probamos en cascada:
  //   1) pointerWithin: el puntero literalmente está sobre un drop
  //      target → el más fiable en touch.
  //   2) rectIntersection: el rect del overlay solapa con algún
  //      target → cubre cuando el puntero queda en el padding.
  //   3) closestCenter: fallback final por distancia al centro.
  const collisionDetectionStrategy: CollisionDetection = (args) => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) return pointer;
    const intersect = rectIntersection(args);
    if (intersect.length > 0) return intersect;
    return closestCenter(args);
  };

  const tasksByColumn = useMemo(() => {
    const map: Record<string, UiTask[]> = {};
    // Marca local: cuando una tarea es "compartida" en el proyecto
    // que estamos viendo (no es su proyecto principal), queremos que
    // aparezca ARRIBA de la columna. Lo conseguimos guardando dos
    // arrays por columna: shared (arriba) y own (resto). Al final los
    // concatenamos.
    const shared: Record<string, UiTask[]> = {};
    for (const c of orderedColumns) {
      map[c.id] = [];
      shared[c.id] = [];
    }
    for (const t of filtered) {
      let status: string;
      const isPrimary = t.projectId === filters.project || filters.project === "all";
      if (isPrimary) {
        status = String(t.status);
      } else {
        const extraStatus = t.extraProjectStatuses?.[filters.project];
        status = extraStatus ?? (orderedColumns[0]?.id ?? String(t.status));
      }
      const targetMap = isPrimary ? map : shared;
      if (targetMap[status]) targetMap[status].push(t);
      else {
        const first = orderedColumns[0]?.id;
        if (first) (isPrimary ? map : shared)[first].push({ ...t, status: first });
      }
    }
    // Concatenamos: primero las compartidas (entran arriba), luego
    // las propias del proyecto.
    const merged: Record<string, UiTask[]> = {};
    for (const c of orderedColumns) merged[c.id] = [...shared[c.id], ...map[c.id]];
    return merged;
  }, [filtered, orderedColumns, filters.project]);

  function persistColumnOrder(order: string[]) {
    setUserColumnOrder(order);
    try {
      localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(order));
    } catch {}
  }

  async function persistTaskReorder(items: { id: string; order: number; status?: string }[]) {
    try {
      await fetch("/api/v1/tasks/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items })
      });
    } catch (e) {
      console.warn("Reorder API falló:", e);
    }
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over) return;
    const activeType = active.data.current?.type;
    const overType = over.data.current?.type;

    if (activeType === "column" && overType === "column" && active.id !== over.id) {
      const currentOrder = orderedColumns.map((c) => c.id);
      const oldIdx = currentOrder.indexOf(String(active.id));
      const newIdx = currentOrder.indexOf(String(over.id));
      if (oldIdx === -1 || newIdx === -1) return;
      persistColumnOrder(arrayMove(currentOrder, oldIdx, newIdx));
      return;
    }

    if (activeType === "task") {
      const activeTaskId = String(active.id);
      const activeTask = tasks.find((t) => t.id === activeTaskId);
      if (!activeTask) return;

      let destColumn: string;
      if (overType === "column") {
        destColumn = String(over.id);
      } else if (overType === "task") {
        const overTask = tasks.find((t) => t.id === String(over.id));
        if (!overTask) return;
        destColumn = String(overTask.status);
      } else return;

      const sourceColumn = String(activeTask.status);

      setTasks((prev) => {
        const next = prev.slice();
        const taskIdx = next.findIndex((t) => t.id === activeTaskId);
        next[taskIdx] = { ...next[taskIdx], status: destColumn };

        const destAfter = next.filter((t) => String(t.status) === destColumn);
        let newIndex: number;
        if (overType === "task") {
          newIndex = destAfter.findIndex((t) => t.id === String(over.id));
          if (newIndex === -1) newIndex = destAfter.length;
        } else {
          newIndex = destAfter.length;
        }
        const reordered = sourceColumn === destColumn
          ? arrayMove(destAfter, destAfter.findIndex((t) => t.id === activeTaskId), newIndex)
          : (() => {
              const others = destAfter.filter((t) => t.id !== activeTaskId);
              others.splice(newIndex, 0, next[taskIdx]);
              return others;
            })();

        const updates: { id: string; order: number; status?: string }[] = [];
        reordered.forEach((t, idx) => {
          updates.push({
            id: t.id,
            order: idx,
            ...(t.id === activeTaskId ? { status: destColumn } : {})
          });
        });
        if (sourceColumn !== destColumn) {
          const sourceAfter = next.filter((t) => String(t.status) === sourceColumn && t.id !== activeTaskId);
          sourceAfter.forEach((t, idx) => updates.push({ id: t.id, order: idx }));
        }
        persistTaskReorder(updates);
        return next;
      });
    }
  }

  const activeTaskBeingDragged = activeDragId ? tasks.find((t) => t.id === activeDragId) ?? null : null;
  const isAdmin = !columnsLoaded; // placeholder; usaremos el endpoint /me en futuro si hace falta

  return (
    // Sin max-w: el tablero ocupa todo el ancho disponible, estilo Asana.
    // Las columnas se vuelven más anchas en monitores grandes.
    // flex column + min-h-screen para que las columnas se estiren hasta
    // abajo cuando no hay otra cosa que las empuje.
    <div className="flex flex-col min-h-[calc(100vh-8rem)]">
      {/* Cabecera + filtros: ocultos en mobile. En el móvil ganamos
          espacio vertical para las columnas — el user crea tareas
          desde los FABs flotantes y filtra (cuando haga falta) desde
          una hoja inferior que se abrirá con un botón. */}

      {/* Panel diagnóstico de Sonia — visible siempre. Muestra estado
          del polling y nº de tasks activas. Sin esto el bug
          "no veo el morado" es invisible. Si lastPollError = null y
          activeCount > 0, debería verse el banner morado en las
          tarjetas. Si activeCount = 0 cuando le pediste a Sonia algo,
          es problema de backend (no creó el run). Si hay error, es
          de auth/network. */}
      <AiSoniaDebugPanel
        debug={aiDebug}
        activeMap={aiStatusByTask}
        tasks={tasks}
        onOpenTask={openEditTask}
      />

      <div className="hidden md:block">
      <PageHeader
        title="Tareas y proyectos"
        description={selectionMode ? `${selected.size} tareas seleccionadas` : "Gestiona el flujo de trabajo de toda la agencia."}
        actions={
          <>
            <div className="flex items-center bg-white border rounded-lg p-0.5">
              <button
                onClick={() => setView("kanban")}
                className={clsx(
                  "px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5",
                  view === "kanban" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-900"
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Tablero
              </button>
              <button
                onClick={() => setView("list")}
                className={clsx(
                  "px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5",
                  view === "list" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-900"
                )}
              >
                <List className="h-3.5 w-3.5" />
                Lista
              </button>
            </div>
            <button
              onClick={() => setSelectionMode((v) => !v)}
              className={clsx(
                "inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border",
                selectionMode
                  ? "bg-brand-50 border-brand-300 text-brand-700"
                  : "bg-white text-slate-700 hover:bg-slate-50"
              )}
            >
              {selectionMode ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              {selectionMode ? "Cancelar selección" : "Seleccionar"}
            </button>
            <button
              onClick={() => setNewProjectOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border text-slate-700 hover:bg-slate-50 text-sm font-medium"
            >
              <FolderPlus className="h-4 w-4" />
              Nuevo proyecto
            </button>
            <button
              onClick={() => openNewTask()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Nueva tarea
            </button>
          </>
        }
      />

      {/* Filtros: en móvil overflow-x scrollable; en >=sm wrap normal. */}
      <div className="flex items-center gap-2 mb-3 flex-nowrap sm:flex-wrap overflow-x-auto sm:overflow-visible -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-thin">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border text-xs shrink-0">
          <Filter className="h-3.5 w-3.5 text-slate-400" />
          <select
            value={filters.project}
            onChange={(e) => setFilters((f) => ({ ...f, project: e.target.value }))}
            className="bg-transparent font-medium focus:outline-none"
          >
            <option value="all">Todos los proyectos</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <select
          value={filters.client}
          onChange={(e) => setFilters((f) => ({ ...f, client: e.target.value }))}
          className="px-3 py-1.5 rounded-lg bg-white border text-xs focus:outline-none shrink-0"
        >
          <option value="all">Todos los clientes</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={filters.assignee}
          onChange={(e) => setFilters((f) => ({ ...f, assignee: e.target.value }))}
          className="px-3 py-1.5 rounded-lg bg-white border text-xs focus:outline-none shrink-0"
        >
          <option value="all">Todos los asignados</option>
          <option value="me">Mis tareas</option>
          <option value="none">Sin asignar</option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <select
          value={filters.priority}
          onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}
          className="px-3 py-1.5 rounded-lg bg-white border text-xs focus:outline-none shrink-0"
        >
          <option value="all">Prioridad…</option>
          <option value="urgencia">🚨 Urgencia</option>
          <option value="alta">Alta</option>
          <option value="normal">Normal (sin prioridad)</option>
        </select>
        <select
          value={filters.due}
          onChange={(e) => setFilters((f) => ({ ...f, due: e.target.value as TaskFilters["due"] }))}
          className="px-3 py-1.5 rounded-lg bg-white border text-xs focus:outline-none shrink-0"
        >
          <option value="all">Vencimiento…</option>
          <option value="overdue">Vencidas</option>
          <option value="today">Hoy</option>
          <option value="week">Esta semana</option>
          <option value="no-date">Sin fecha</option>
        </select>
        <input
          type="text"
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          placeholder="Buscar título…"
          className="px-3 py-1.5 rounded-lg bg-white border text-xs focus:outline-none w-32 sm:w-40 shrink-0"
        />
        <a
          href="/admin/columnas"
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border text-xs text-slate-600 hover:text-slate-900 ml-auto"
          title="Configurar columnas del kanban"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Columnas
        </a>
      </div>
      <div className="mb-5">
        <SavedFiltersBar filters={filters} onApply={setFilters} />
      </div>
      </div>

      {view === "kanban" ? (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetectionStrategy}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={orderedColumns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
            {/* Móvil: scroll horizontal con columnas de ~280px (típico kanban).
                Tablet/desktop: grid uniforme. +1 columna placeholder al final
                con un botón "+" para añadir columna en línea. */}
            <KanbanGrid
              columnCount={orderedColumns.length + 1}
              isMobile={isMobile}
              isDragging={!!activeDragId}
            >
              {orderedColumns.map((col) => (
                <KanbanColumnView
                  key={col.id}
                  column={col}
                  tasks={tasksByColumn[col.id] ?? []}
                  onAddTask={() => openNewTask(col.id)}
                  onOpenTask={openEditTask}
                  selectionMode={selectionMode}
                  selectedIds={selected}
                  onToggleSelected={toggleSelected}
                  getProject={getProject}
                  getClient={getClient}
                  team={team}
                  columns={columns}
                  aiStatusByTask={aiStatusByTask}
                  onMarkAiReviewed={markAiReviewed}
                  columnsEndpoint={columnsEndpoint}
                />
              ))}
              <AddColumnButton
                existingColumns={columns}
                endpoint={columnsEndpoint}
                onCreated={async () => {
                  // Recargamos las columnas DEL CONTEXTO ACTUAL (proyecto
                  // o workspace). Y si era un proyecto, re-pedimos la lista
                  // de proyectos para que projects[i].kanbanColumns refleje
                  // lo nuevo en el siguiente useMemo.
                  const r = await fetch(columnsEndpoint);
                  if (r.ok) {
                    const d = await r.json();
                    if (filters.project === "all") {
                      setColumns(d.items ?? []);
                    } else {
                      // refresca tareas/projects para que kanbanColumns del
                      // proyecto se hidrate. Lo más simple: reload.
                      if (typeof window !== "undefined") window.location.reload();
                    }
                  }
                }}
              />
            </KanbanGrid>
          </SortableContext>
          <DragOverlay>
            {activeTaskBeingDragged && (
              <TaskCard
                task={activeTaskBeingDragged}
                project={getProject(activeTaskBeingDragged.projectId)}
                client={getClient(activeTaskBeingDragged.clientId)}
                team={team}
                isOverlay
                columns={columns}
              />
            )}
          </DragOverlay>
        </DndContext>
      ) : (
        <div className="bg-white rounded-xl border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {selectionMode && <th className="w-10 px-3 py-3"></th>}
                <th className="text-left px-5 py-3">Tarea</th>
                <th className="text-left px-3 py-3 hidden md:table-cell">Proyecto</th>
                <th className="text-left px-3 py-3">Estado</th>
                <th className="text-left px-3 py-3 hidden lg:table-cell">Prioridad</th>
                <th className="text-left px-3 py-3 hidden sm:table-cell">Asignados</th>
                <th className="text-left px-3 py-3 hidden sm:table-cell">Entrega</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((t) => {
                const project = getProject(t.projectId);
                const client = getClient(t.clientId);
                const isSelected = selected.has(t.id);
                return (
                  <tr
                    key={t.id}
                    onClick={() => openEditTask(t)}
                    className={clsx("cursor-pointer", isSelected ? "bg-brand-50" : "hover:bg-slate-50")}
                  >
                    {selectionMode && (
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelected(t.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                    )}
                    <td className="px-3 sm:px-5 py-3">
                      <div className="font-medium">{t.title}</div>
                      <div className="text-xs text-slate-500 truncate">
                        {client?.name}
                        {/* En móvil, condensamos prioridad y entrega bajo el título */}
                        <span className="sm:hidden ml-2">
                          {t.dueDate && (
                            <span className="text-slate-400">
                              · {new Date(t.dueDate).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${project?.color ?? "bg-slate-300"}`} />
                        <span className="text-xs">{project?.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-xs px-2 py-1 rounded-md border ${statusColorOf(String(t.status), columns)}`}>
                        {statusLabelOf(String(t.status), columns)}
                      </span>
                    </td>
                    <td className="px-3 py-3 hidden lg:table-cell">
                      {/* Solo mostramos pill si la prioridad es ALTA o
                          URGENCIA; las demás (media/baja "normales")
                          se dejan vacías para no añadir ruido. */}
                      {(t.priority === "alta" || t.priority === "urgencia") && (
                        <span className={`text-xs px-2 py-1 rounded ${priorityColors[t.priority]}`}>
                          {priorityLabels[t.priority]}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 hidden sm:table-cell">
                      <AvatarStack ids={t.assigneeIds} size={6} members={team} />
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600 hidden sm:table-cell">
                      {t.dueDate && new Date(t.dueDate).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <TaskFormModal
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        projects={projects}
        team={team}
        task={editingTask}
        defaultStatus={newTaskStatus}
        defaultProjectId={projectFilter !== "all" ? projectFilter : undefined}
        columns={columns}
      />
      <ProjectFormModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} clients={clients} />

      {/* FABs flotantes en mobile (solo md-): reunión rápida + crear tarea */}
      <MobileFABs
        onQuickMeeting={handleQuickMeeting}
        onTaskByVoice={handleTaskByVoice}
        onTaskByText={handleTaskByText}
      />

      {/* Modal grabador de tareas por voz (Whisper + Claude maquetan).
          Si el user decide editar antes de crear, abrimos
          TaskFormModal con preset — usamos editingTask como puente. */}
      <VoiceTaskRecorder
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        defaultProjectId={projectFilter !== "all" ? projectFilter : undefined}
        onCreated={() => {
          setVoiceOpen(false);
          router.refresh();
        }}
        onOpenInForm={(preset) => {
          setVoiceOpen(false);
          // Pre-rellenamos un editingTask "virtual" para que
          // TaskFormModal pinte los campos. id vacío lo trata como
          // creación nueva.
          setEditingTask({
            id: "",
            title: preset.title,
            description: preset.description ?? "",
            projectId: preset.projectId ?? (projectFilter !== "all" ? projectFilter : projects[0]?.id ?? ""),
            assigneeIds: preset.assigneeIds ?? [],
            priority: preset.priority === "urgent" ? "urgencia" : preset.priority === "high" ? "alta" : "",
            dueDate: preset.dueDate,
            status: orderedColumns[0]?.id ?? "TODO"
          } as any);
          setNewTaskOpen(true);
        }}
      />

      {/* Grabador de reunión disparado desde FAB1 — abierto sobre la
          tarea recién creada. onComment refresca el listado para que
          el resumen aparezca al volver. */}
      {quickMeetingTaskId && (
        <MeetingRecorder
          taskId={quickMeetingTaskId}
          open={!!quickMeetingTaskId}
          onClose={() => {
            setQuickMeetingTaskId(null);
            router.refresh();
          }}
          onComment={() => router.refresh()}
        />
      )}

      {quickMeetingError && (
        <div className="fixed inset-x-4 bottom-24 md:bottom-6 z-[70] mx-auto max-w-md rounded-lg bg-rose-600 text-white px-4 py-3 shadow-lg">
          <div className="flex items-start gap-2">
            <span className="text-sm flex-1">{quickMeetingError}</span>
            <button
              type="button"
              onClick={() => setQuickMeetingError(null)}
              className="text-white/80 hover:text-white text-sm"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {creatingQuickMeeting && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/30 backdrop-blur-sm">
          <div className="rounded-lg bg-white px-5 py-4 shadow-xl flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
            <span className="text-sm font-medium">Creando tarea…</span>
          </div>
        </div>
      )}

      {selectionMode && selected.size > 0 && (
        <BulkActionBar
          count={selected.size}
          selectedIds={Array.from(selected)}
          projects={projects}
          team={team}
          columns={columns}
          onDone={() => {
            clearSelection();
            // Forzar re-fetch desde el servidor — la página re-renderiza props
            if (typeof window !== "undefined") window.location.reload();
          }}
          onCancel={clearSelection}
        />
      )}
    </div>
  );
}

/**
 * Wrapper responsivo:
 * - Móvil: flex con scroll horizontal, columnas con ancho fijo (280px) → swipe.
 * - md+: grid con columnas que reparten ancho.
 */
function KanbanGrid({
  columnCount,
  children,
  isMobile,
  isDragging
}: {
  columnCount: number;
  children: React.ReactNode;
  isMobile?: boolean;
  isDragging?: boolean;
}) {
  // Layout estilo Asana: en móvil columna casi al 100% del viewport
  // (88vw) con la siguiente asomando ~12vw para indicar swipe. Snap
  // mandatory ancla cada columna al hacer scroll horizontal. En sm+
  // columnas de 320-360px que ocupan más densas el ancho disponible.
  //
  // Durante drag desactivamos el snap — pelea con dnd-kit (la columna
  // hace snap a la siguiente justo cuando intentas soltar una tarea
  // sobre ella, y `over` queda mal) y bloquea el auto-scroll
  // horizontal mientras arrastras una tarea entre columnas.
  const snapClass = isDragging ? "" : "snap-x snap-mandatory sm:snap-none";
  return (
    <div
      className={`grid grid-flow-col gap-2 sm:gap-4 overflow-x-auto pb-2 ${snapClass} flex-1 [&>*]:min-h-full [&>*]:snap-start`}
      style={{
        gridAutoColumns: isMobile
          ? "88vw"
          : `minmax(320px, ${columnCount <= 6 ? "1fr" : "360px"})`
      }}
    >
      {children}
    </div>
  );
}

/**
 * Placeholder con "+" al final de las columnas. Al pulsarlo se expande un
 * formulario inline (nombre + color preset). Al guardar, llama PUT
 * /api/v1/kanban-columns con la lista completa actualizada.
 */
function AddColumnButton({
  existingColumns,
  onCreated,
  endpoint
}: {
  existingColumns: KanbanColumn[];
  onCreated: () => void | Promise<void>;
  /** Endpoint donde PUT la lista actualizada. Workspace global o
   *  proyecto-específico — el caller decide. */
  endpoint: string;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("bg-violet-100 text-violet-800 border-violet-300");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const colorPresets = COLUMN_COLOR_PRESETS;

  function slugifyId(s: string): string {
    return s
      .toUpperCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
  }

  async function save() {
    setError(null);
    const cleanId = slugifyId(name);
    if (!name.trim() || !cleanId) {
      setError("Nombre requerido");
      return;
    }
    if (existingColumns.some((c) => c.id === cleanId)) {
      setError("Ya existe una columna con ese ID");
      return;
    }
    setSaving(true);
    const next = [
      ...existingColumns.map((c, i) => ({
        id: c.id,
        label: c.label,
        color: c.color,
        order: i,
        isDone: c.isDone === true
      })),
      {
        id: cleanId,
        label: name.trim(),
        color,
        order: existingColumns.length,
        isDone: false
      }
    ];
    const r = await fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columns: next })
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    setName("");
    setEditing(false);
    await onCreated();
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="bg-slate-50/40 border-2 border-dashed border-slate-200 rounded-xl p-3 min-h-[400px] flex flex-col items-center justify-center gap-2 text-slate-400 hover:bg-slate-100 hover:border-slate-300 hover:text-slate-700 transition"
        title="Añadir columna"
      >
        <Plus className="h-6 w-6" />
        <span className="text-xs font-medium">Nueva columna</span>
      </button>
    );
  }

  return (
    <div className="bg-white border border-brand-300 rounded-xl p-3 min-h-[200px]">
      <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">
        Nueva columna
      </div>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="Ej. Bloqueada"
        maxLength={40}
        className="w-full px-2 py-1.5 rounded-md border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 mb-2"
      />
      <div className="flex flex-wrap gap-1 mb-2">
        {colorPresets.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setColor(p.value)}
            className={
              "h-5 w-5 rounded-full border-2 transition " +
              p.value.split(" ")[0] +
              " " +
              (color === p.value ? "border-slate-900 scale-110" : "border-white")
            }
            title={p.label}
          />
        ))}
      </div>
      {name && (
        <div className="mb-2">
          <span className={`text-xs px-2 py-0.5 rounded-md border ${color}`}>{name}</span>
        </div>
      )}
      {error && <p className="text-xs text-rose-600 mb-2">{error}</p>}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={save}
          disabled={saving || !name.trim()}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Crear
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setName(""); setError(null); }}
          className="px-2 py-1.5 rounded-md border bg-white hover:bg-slate-50 text-xs"
        >
          Cancelar
        </button>
      </div>
      <p className="text-[11px] text-slate-500 mt-2">
        Más opciones (renombrar, reordenar, marcar como "Hecha") en{" "}
        <a href="/admin/columnas" className="underline">/admin/columnas</a>.
      </p>
    </div>
  );
}

function KanbanColumnView({
  column,
  tasks,
  onAddTask,
  onOpenTask,
  selectionMode,
  selectedIds,
  onToggleSelected,
  getProject,
  getClient,
  team,
  columns,
  aiStatusByTask,
  onMarkAiReviewed,
  columnsEndpoint
}: {
  column: KanbanColumn;
  tasks: UiTask[];
  onAddTask: () => void;
  onOpenTask: (t: UiTask) => void;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  getProject: (id?: string) => UiProject | undefined;
  getClient: (id?: string) => UiClient | undefined;
  team: UiMember[];
  columns: KanbanColumn[];
  aiStatusByTask: Record<string, AiStatusInfo>;
  onMarkAiReviewed?: (taskId: string) => void;
  /** Endpoint donde se PUTean cambios de columnas (workspace o proyecto). */
  columnsEndpoint: string;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: "column" }
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1
  };
  const taskIds = tasks.map((t) => t.id);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group rounded-xl p-3 min-h-[400px] flex-1 flex flex-col ${softBgFromColor(column.color)}`}
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2 min-w-0">
          <button
            {...attributes}
            {...listeners}
            className="text-slate-400 hover:text-slate-700 cursor-grab active:cursor-grabbing shrink-0"
            aria-label="Mover columna"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <ColumnHeader column={column} allColumns={columns} endpoint={columnsEndpoint} />
          <span className="text-xs text-slate-500 font-medium">{tasks.length}</span>
        </div>
        <button
          onClick={onAddTask}
          className="text-slate-400 hover:text-slate-700"
          aria-label="Añadir tarea"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-2 flex-1">
          {tasks.map((t) => (
            <SortableTask
              key={t.id}
              task={t}
              project={getProject(t.projectId)}
              client={getClient(t.clientId)}
              team={team}
              onClick={() => onOpenTask(t)}
              selectionMode={selectionMode}
              isSelected={selectedIds.has(t.id)}
              onToggleSelected={() => onToggleSelected(t.id)}
              columns={columns}
              aiInfo={aiStatusByTask[t.id]}
              onMarkAiReviewed={onMarkAiReviewed}
            />
          ))}
          {tasks.length === 0 && (
            <div className="text-center py-8 text-xs text-slate-400 italic">
              Suelta aquí o pulsa + para añadir
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableTask({
  task,
  project,
  client,
  team,
  onClick,
  selectionMode,
  isSelected,
  onToggleSelected,
  columns,
  aiInfo,
  onMarkAiReviewed
}: {
  task: UiTask;
  project?: UiProject;
  client?: UiClient;
  team: UiMember[];
  onClick: () => void;
  selectionMode: boolean;
  isSelected: boolean;
  onToggleSelected: () => void;
  columns: KanbanColumn[];
  aiInfo?: AiStatusInfo;
  onMarkAiReviewed?: (taskId: string) => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "task", status: String(task.status) },
    disabled: selectionMode // mientras seleccionas, no se arrastra
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(selectionMode ? {} : attributes)}
      {...(selectionMode ? {} : listeners)}
      onClick={onClick}
    >
      <TaskCard
        task={task}
        project={project}
        client={client}
        team={team}
        selectionMode={selectionMode}
        isSelected={isSelected}
        onToggleSelected={onToggleSelected}
        columns={columns}
        aiInfo={aiInfo}
        onMarkAiReviewed={onMarkAiReviewed}
      />
    </div>
  );
}

function TaskCard({
  task,
  project,
  client,
  team,
  isOverlay,
  selectionMode,
  isSelected,
  onToggleSelected,
  columns,
  aiInfo,
  onMarkAiReviewed
}: {
  task: UiTask;
  project?: UiProject;
  client?: UiClient;
  team: UiMember[];
  isOverlay?: boolean;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelected?: () => void;
  columns?: KanbanColumn[];
  aiInfo?: AiStatusInfo;
  onMarkAiReviewed?: (taskId: string) => void;
}) {
  const aiStatus = aiInfo?.aiStatus ?? null;
  const [copied, setCopied] = useState(false);
  // Tick para refrescar el estado de alarma visual + el "🤖
  // Trabajando 1m 14s" del badge de Sonia. Si Sonia está
  // trabajando ahora mismo, tick cada 1s (el contador del badge
  // avanza suave); si no, cada 60s (basta para la alarma de
  // deadline). El interval se reinicia cuando aiStatus cambia.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const ms = aiStatus === "working" ? 1000 : 60 * 1000;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [aiStatus]);
  const alarmLevel = computeAlarmLevel(task, now);

  async function copyTaskUrl(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const url = `${window.location.origin}/tareas?task=${task.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: selección por prompt
      prompt("URL de la tarea (cópiala con Ctrl+C):", url);
    }
  }

  // Estilos inline para el indicador de Sonia. Los inline NO se
  // purgan jamás — antes con Tailwind+clsx a veces se perdían en
  // build de producción y el indicador no se veía. Borde + sombra +
  // animación CSS propia (sonia-pulse) garantizan visibilidad.
  let soniaStyle: React.CSSProperties = {};
  if (aiStatus && alarmLevel !== "urgent") {
    const colors = {
      working:         { ring: "#7c3aed", glow: "rgba(124,58,237,0.45)", bg: "#f5f3ff" },
      done_unreviewed: { ring: "#10b981", glow: "rgba(16,185,129,0.45)", bg: "#ecfdf5" },
      needs_help:      { ring: "#f59e0b", glow: "rgba(245,158,11,0.55)", bg: "#fffbeb" },
      claude_working:  { ring: "#0ea5e9", glow: "rgba(14,165,233,0.45)", bg: "#f0f9ff" },
      // ai_replied: CYAN BRILLANTE PARPADEANTE — "Sonia te ha
      // contestado, no te lo pierdas". Es el más llamativo de todos:
      // ring grueso + glow intenso + animación más rápida.
      ai_replied:      { ring: "#06b6d4", glow: "rgba(6,182,212,0.75)", bg: "#ecfeff" }
    } as const;
    const c = colors[aiStatus];
    // El estado ai_replied parpadea más rápido y con halo mayor que
    // los demás — es el que más necesita captar la atención.
    const isUrgentAttention = aiStatus === "ai_replied";
    soniaStyle = {
      boxShadow: isUrgentAttention
        ? `0 0 0 4px ${c.ring}, 0 0 28px 8px ${c.glow}`
        : `0 0 0 3px ${c.ring}, 0 0 18px 4px ${c.glow}`,
      backgroundColor: c.bg,
      animation: isUrgentAttention
        ? "sonia-pulse 0.9s ease-in-out infinite"
        : "sonia-pulse 1.6s ease-in-out infinite"
    };
  }

  return (
    <div
      style={soniaStyle}
      className={clsx(
        "rounded-lg border p-3 transition cursor-pointer relative group",
        // Alarma visual según proximidad del dueDate. Sólo aplica a
        // tareas no completadas con fecha y antes del vencimiento.
        alarmLevel === "urgent"
          ? "bg-rose-600 text-white border-rose-700 shadow-lg shadow-rose-200 animate-pulse"
          : alarmLevel === "preaviso"
            ? "bg-white border-rose-500 ring-2 ring-rose-300/60"
            : aiStatus
              ? "" // bg lo pone soniaStyle (inline). alarmLevel ya
                   // es "none" en esta rama (urgent/preaviso
                   // chequeados antes).
              : "bg-white",
        isOverlay ? "shadow-2xl rotate-2 border-brand-400" : alarmLevel === "none" && !aiStatus && "hover:shadow-sm hover:border-brand-200",
        isSelected && !aiStatus && "border-brand-400 ring-2 ring-brand-300/50"
      )}
    >
      {aiStatus && (
        <>
          <AiStatusBadge
            info={aiInfo!}
            now={now}
            onMarkReviewed={
              aiStatus === "done_unreviewed" && onMarkAiReviewed
                ? () => onMarkAiReviewed(task.id)
                : undefined
            }
          />
          <AiStatusBanner info={aiInfo!} now={now} />
        </>
      )}
      {selectionMode && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelected}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2 right-2 h-4 w-4"
        />
      )}
      {/* Botón copiar URL — aparece en hover. No interfiere con drag&drop
          ni con la apertura del modal porque hace stopPropagation. */}
      {!selectionMode && (
        <button
          type="button"
          onClick={copyTaskUrl}
          onPointerDown={(e) => e.stopPropagation()}
          className={
            "absolute top-2 right-2 h-6 w-6 rounded grid place-items-center border transition opacity-0 group-hover:opacity-100 " +
            (copied
              ? "bg-emerald-50 border-emerald-300 text-emerald-700 opacity-100"
              : "bg-white border-slate-200 text-slate-500 hover:text-brand-600 hover:border-brand-300")
          }
          title={copied ? "URL copiada" : "Copiar URL de la tarea"}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
        </button>
      )}
      <div className="flex items-start justify-between gap-2 mb-2 pr-8">
        <p className="text-sm font-medium leading-snug">{task.title}</p>
        {(task.priority === "alta" || task.priority === "urgencia") && (
          <span className={`shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${priorityColors[task.priority]}`}>
            {priorityLabels[task.priority]}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
        <span className={`inline-block h-2 w-2 rounded-full ${project?.color ?? "bg-slate-300"}`} />
        <span className="truncate">{client?.name ?? project?.name}</span>
      </div>
      {task.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {task.tags.map((tag) => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
              #{tag}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <AvatarStack ids={task.assigneeIds} size={6} members={team} />
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <CalendarDays className="h-3 w-3" />
          {task.dueDate ? new Date(task.dueDate).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) : "—"}
        </div>
      </div>
    </div>
  );
}

// Calcula el nivel de alarma visual de una tarea en función del tiempo
// que falta hasta su dueDate. Se alimenta del mismo modelo que el cron
// de notificaciones por email.
//   none      → ya vencida, sin fecha, o aún a >24h
//   preaviso  → dentro del día (después de las 07:00 UTC), pero a más
//               de 1h del vencimiento → borde rojo
//   urgent    → a 1h o menos del vencimiento, antes del vencimiento →
//               tarjeta entera roja pulsante
//   none (de nuevo) → tras la hora de vencimiento se quitan los colores
//                     para que el equipo vea claro que ya pasó.
function computeAlarmLevel(task: UiTask, nowMs: number): "none" | "preaviso" | "urgent" {
  if (!task.dueDate) return "none";
  // dueDate puede venir como YYYY-MM-DD (UiTask "limpio") o como
  // string ISO completo "YYYY-MM-DDTHH:MM:SS.sssZ" (cuando viene de
  // mutaciones recientes o imports de Asana). Normalizamos a parte
  // de fecha YYYY-MM-DD antes de concatenar la hora.
  const rawDate = String(task.dueDate ?? "");
  const datePart = rawDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return "none";
  const timePart = task.dueTime ?? (task.dueAllDay !== false ? "23:59" : "00:00");
  const due = new Date(`${datePart}T${timePart}:00.000Z`).getTime();
  if (isNaN(due)) return "none";
  const diffMs = due - nowMs;
  if (diffMs < 0) return "none"; // ya vencida → estado normal
  if (diffMs <= 60 * 60 * 1000) return "urgent"; // ≤ 1h
  // "preaviso": mismo día y ya son ≥ 07:00 UTC (paridad con el cron
  // day_7am). Por tanto sólo aplica el día del vencimiento, no varios
  // días antes.
  const dueDay = new Date(`${datePart}T00:00:00.000Z`).getTime();
  const startOfWindow = dueDay + 7 * 60 * 60 * 1000; // 07:00 UTC del día
  if (nowMs >= startOfWindow && nowMs < due) return "preaviso";
  return "none";
}

/**
 * Header editable de una columna del Kanban: click para renombrar,
 * icono de gota para recolorar. Solo admins pueden guardar; los
 * miembros ven el header normal sin botones de edición.
 *
 * Por simplicidad de POST: como el endpoint pide TODAS las columnas
 * en la actualización (PUT /api/v1/kanban-columns), recibimos
 * `allColumns` y mandamos la lista entera con esta sustituida.
 */
function ColumnHeader({
  column,
  allColumns,
  endpoint
}: {
  column: KanbanColumn;
  allColumns: KanbanColumn[];
  /** Endpoint donde PUT los cambios (workspace o proyecto). */
  endpoint: string;
}) {
  const { data: session } = useSession();
  const isAdmin = ((session?.user as any)?.role ?? "") === "ADMIN";
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(column.label);
  const [showColors, setShowColors] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraftName(column.label);
      setTimeout(() => inputRef.current?.select(), 30);
    }
  }, [editing, column.label]);

  async function persist(next: KanbanColumn) {
    const all = allColumns.map((c) => (c.id === next.id ? next : c));
    setSaving(true);
    try {
      const r = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columns: all })
      });
      if (r.ok) {
        // Refresca la página para que las columnas y filtros vean
        // el cambio sin tener que recargar manualmente.
        if (typeof window !== "undefined") window.location.reload();
      }
    } finally {
      setSaving(false);
    }
  }

  function commitName() {
    const value = draftName.trim();
    setEditing(false);
    if (!value || value === column.label) return;
    persist({ ...column, label: value });
  }

  function pickColor(value: string) {
    setShowColors(false);
    if (value === column.color) return;
    persist({ ...column, color: value });
  }

  if (editing && isAdmin) {
    return (
      <input
        ref={inputRef}
        value={draftName}
        onChange={(e) => setDraftName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitName();
          if (e.key === "Escape") setEditing(false);
        }}
        disabled={saving}
        className={`text-sm font-bold uppercase tracking-wide px-2.5 py-1 rounded-md border outline-none focus:ring-2 focus:ring-brand-500 ${column.color}`}
        style={{ maxWidth: 200 }}
      />
    );
  }

  return (
    <div className="relative inline-flex items-center gap-1 min-w-0">
      <span
        onDoubleClick={() => isAdmin && setEditing(true)}
        className={`text-sm font-bold uppercase tracking-wide px-2.5 py-1 rounded-md border truncate ${column.color} ${isAdmin ? "cursor-pointer" : ""}`}
        title={isAdmin ? "Doble click para renombrar" : column.label}
      >
        {column.label}
      </span>
      {isAdmin && (
        <button
          type="button"
          onClick={() => setShowColors((v) => !v)}
          className="text-slate-400 hover:text-slate-700 opacity-0 group-hover:opacity-100 transition shrink-0"
          aria-label="Cambiar color"
          title="Cambiar color"
        >
          {/* gota / dot circular */}
          <span className={`block h-3 w-3 rounded-full border ${column.color}`} />
        </button>
      )}
      {showColors && isAdmin && (
        <div className="absolute top-full left-0 mt-1 z-20 bg-white rounded-lg border shadow-lg p-2 grid grid-cols-4 gap-1 w-[200px]">
          {COLUMN_COLOR_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => pickColor(p.value)}
              className={`h-7 rounded-md border ${p.value} text-[10px] font-bold uppercase tracking-tight`}
              title={p.label}
            >
              Aa
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Dado el `color` (clase de header de columna), devuelve el fondo
 * suave para todo el wrapper de la columna. Lista cerrada porque
 * Tailwind necesita clases estáticas para purgar; los valores son
 * los que ofrecen los presets en COLUMN_COLOR_PRESETS.
 *
 * Para tonos pastel devolvemos el bg-X-50; para tonos intensos
 * (rosa, naranja, esmeralda, negro), un tono medio del mismo color
 * para que la columna entera respire el mismo aire que la cabecera
 * sin saturar.
 */
function softBgFromColor(color: string): string {
  const m: Record<string, string> = {
    "bg-slate-100 text-slate-700 border-slate-200": "bg-slate-100/60",
    "bg-sky-100 text-sky-800 border-sky-300": "bg-sky-50",
    "bg-indigo-50 text-indigo-700 border-indigo-200": "bg-indigo-50/60",
    "bg-amber-100 text-amber-800 border-amber-300": "bg-amber-50",
    "bg-emerald-100 text-emerald-800 border-emerald-300": "bg-emerald-50",
    "bg-rose-100 text-rose-800 border-rose-300": "bg-rose-50",
    "bg-violet-100 text-violet-800 border-violet-300": "bg-violet-50",
    // Tonos intensos: usamos un tone-100 más vibrante en el wrapper
    // para que se note que es una columna "fuerte" pero no sature.
    "bg-rose-600 text-white border-rose-700": "bg-rose-100",
    "bg-orange-500 text-white border-orange-700": "bg-orange-100",
    "bg-emerald-600 text-white border-emerald-700": "bg-emerald-100",
    "bg-slate-900 text-white border-slate-900": "bg-slate-200"
  };
  return m[color] ?? "bg-slate-100/60";
}

/**
 * Badge informativo de Sonia en la esquina superior-izquierda de
 * la card. Muestra:
 *   - working: "🤖 Trabajando 2m 14s" (morado, parpadea)
 *   - done_unreviewed: "✓ Lista hace 3m" (verde, clic = marcar revisado)
 *   - needs_help: "⚠️ Pide ayuda" (naranja)
 *
 * Tooltip nativo (title=) con summary/error completo si los hay.
 */
function AiStatusBadge({
  info,
  now,
  onMarkReviewed
}: {
  info: AiStatusInfo;
  now: number;
  onMarkReviewed?: () => void;
}) {
  const refMs = info.startedAt ? new Date(info.startedAt).getTime() : null;
  const endMs = info.finishedAt ? new Date(info.finishedAt).getTime() : null;
  const elapsedMs =
    info.aiStatus === "working" && refMs
      ? Math.max(0, now - refMs)
      : endMs && refMs
        ? Math.max(0, endMs - refMs)
        : 0;
  const sinceFinishedMs = endMs ? Math.max(0, now - endMs) : 0;

  let label: string;
  // Estilos inline en lugar de clases Tailwind para evitar purge.
  let bg = "";
  let border = "";
  let tooltip = "";
  let href: string | null = null;
  if (info.aiStatus === "working") {
    label = `🤖 Trabajando ${formatDuration(elapsedMs)}`;
    bg = "#7c3aed";
    border = "#6d28d9";
    tooltip = `Sonia trabajando — ${info.stepsCount ?? 0} pasos. ${info.runStatus === "PENDING" ? "Aún en cola." : "Ejecutando tools."}`;
  } else if (info.aiStatus === "done_unreviewed") {
    label = `✓ Lista${sinceFinishedMs > 0 ? ` · hace ${formatDuration(sinceFinishedMs)}` : ""}`;
    bg = "#10b981";
    border = "#059669";
    tooltip = info.summary ?? "Sonia terminó. Click para marcar revisado.";
  } else if (info.aiStatus === "needs_help") {
    label = `⚠️ Pide ayuda`;
    bg = "#f59e0b";
    border = "#d97706";
    tooltip = info.summary ?? info.error ?? "Sonia necesita tu intervención.";
  } else if (info.aiStatus === "claude_working") {
    label = info.escalationIssueNumber
      ? `🛠 Claude mejorando · #${info.escalationIssueNumber}`
      : `🛠 Claude mejorando`;
    bg = "#0ea5e9";
    border = "#0284c7";
    tooltip =
      (info.summary ? info.summary + " — " : "") +
      "Claude está mejorando el sistema para resolver esto. Click para abrir el issue en GitHub.";
    href = info.escalationIssueUrl ?? null;
  } else if (info.aiStatus === "ai_replied") {
    label = `💬 Sonia ha contestado`;
    bg = "#06b6d4";
    border = "#0891b2";
    tooltip = info.lastAiCommentPreview
      ? `«${info.lastAiCommentPreview}» — Click para marcar revisado.`
      : "Sonia añadió un comentario nuevo. Click para abrir.";
  } else {
    return null;
  }

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    top: -8,
    left: -8,
    zIndex: 10,
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    color: "#ffffff",
    backgroundColor: bg,
    border: `1px solid ${border}`,
    boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
    cursor: onMarkReviewed || href ? "pointer" : "default",
    textDecoration: "none",
    whiteSpace: "nowrap"
  };

  // Link a GitHub issue si claude_working. Nuevo tab.
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        title={tooltip}
        style={baseStyle}
      >
        {label}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        if (onMarkReviewed) {
          e.stopPropagation();
          e.preventDefault();
          onMarkReviewed();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={tooltip}
      style={baseStyle}
    >
      {label}
    </button>
  );
}

/**
 * Banda informativa dentro de la card (encima del título). A diferencia
 * del AiStatusBadge (chip pequeño en la esquina), esto es una barra
 * ANCHA y descriptiva pensada para que cualquier persona viendo el
 * tablero entienda QUÉ está pasando con Sonia/Claude sin abrir la
 * tarea:
 *
 *   - working          → "🤖 Sonia trabajando · leyendo métricas Meta · 2m 14s"
 *   - ai_replied       → "💬 SONIA TE HA CONTESTADO · «aquí tienes el…»"
 *   - done_unreviewed  → "✓ Sonia terminó · «recomendación: escalar B…»"
 *   - needs_help       → "⚠️ Sonia pide ayuda · «no tengo token Meta…»"
 *   - claude_working   → "🛠 Claude mejorando el sistema · #42 · ver issue"
 */
function AiStatusBanner({ info, now }: { info: AiStatusInfo; now: number }) {
  const refMs = info.startedAt ? new Date(info.startedAt).getTime() : null;
  const elapsedMs =
    info.aiStatus === "working" && refMs ? Math.max(0, now - refMs) : 0;
  let line1: string;
  let line2: string | null = null;
  let bg = "";
  let textColor = "#ffffff";
  if (info.aiStatus === "working") {
    line1 = `🤖 Sonia está trabajando en esta tarea`;
    const dur = elapsedMs > 0 ? ` · ${formatDuration(elapsedMs)}` : "";
    const step = info.lastStepText ? ` · ${info.lastStepText}` : "";
    line2 = `paso ${info.stepsCount ?? 0}${dur}${step}`;
    bg = "#7c3aed";
  } else if (info.aiStatus === "ai_replied") {
    line1 = `💬 SONIA TE HA CONTESTADO`;
    line2 = info.lastAiCommentPreview
      ? `«${info.lastAiCommentPreview}»`
      : "Click para leer su respuesta";
    bg = "#06b6d4";
  } else if (info.aiStatus === "done_unreviewed") {
    line1 = `✓ Sonia terminó · revisar`;
    line2 = info.summary ? `«${info.summary}»` : null;
    bg = "#10b981";
  } else if (info.aiStatus === "needs_help") {
    line1 = `⚠️ Sonia necesita tu ayuda`;
    line2 = info.summary || info.error || null;
    bg = "#f59e0b";
  } else if (info.aiStatus === "claude_working") {
    line1 = `🛠 Claude está mejorando el sistema${info.escalationIssueNumber ? ` · issue #${info.escalationIssueNumber}` : ""}`;
    line2 = info.summary
      ? `Por: ${info.summary.slice(0, 80)}`
      : "El user no tiene que hacer nada — Claude lo resuelve y re-procesa.";
    bg = "#0ea5e9";
  } else {
    return null;
  }

  return (
    <div
      style={{
        backgroundColor: bg,
        color: textColor,
        padding: "5px 8px",
        marginBottom: 8,
        marginLeft: -4,
        marginRight: -4,
        marginTop: -4,
        borderTopLeftRadius: 6,
        borderTopRightRadius: 6,
        fontSize: 11,
        lineHeight: 1.35,
        boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.08)"
      }}
    >
      <div style={{ fontWeight: 700 }}>{line1}</div>
      {line2 && (
        <div
          style={{
            opacity: 0.92,
            fontWeight: 400,
            marginTop: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {line2}
        </div>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

/**
 * Panel visible siempre en /tareas con el estado del polling de
 * Sonia. Si "no veo el morado", este panel revela en qué paso falla
 * el sistema: polling muerto, backend devuelve 401, runs vacíos, etc.
 *
 * Visible solo en desktop (md+) para no estorbar en móvil.
 */
function AiSoniaDebugPanel({
  debug,
  activeMap,
  tasks,
  onOpenTask
}: {
  debug: {
    lastPollAt: number | null;
    lastPollOk: boolean;
    lastPollError: string | null;
    activeCount: number;
    pollCount: number;
  };
  activeMap: Record<string, AiStatusInfo>;
  tasks: UiTask[];
  onOpenTask: (t: UiTask) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secsSincePoll = debug.lastPollAt
    ? Math.floor((now - debug.lastPollAt) / 1000)
    : null;
  const statesByCount: Record<string, number> = {};
  for (const v of Object.values(activeMap)) {
    if (v.aiStatus) statesByCount[v.aiStatus] = (statesByCount[v.aiStatus] ?? 0) + 1;
  }
  const isHealthy = debug.lastPollOk && secsSincePoll !== null && secsSincePoll < 30;
  // Lookup taskId → task (para mostrar título + saber si está
  // visible en el filtro actual).
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const activeEntries = Object.entries(activeMap)
    .filter(([, v]) => v.aiStatus !== null)
    .map(([taskId, info]) => ({ taskId, info, task: taskById.get(taskId) }));
  return (
    <div
      className="hidden md:block text-xs border-b bg-slate-50"
      style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-1.5 hover:bg-slate-100 transition text-left"
        title="Click para expandir/contraer detalles"
      >
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: 99,
            backgroundColor: isHealthy ? "#10b981" : debug.lastPollError ? "#ef4444" : "#94a3b8"
          }}
        />
        <span className="text-slate-700 font-semibold">Sonia status</span>
        <span className="text-slate-500">
          polling: {debug.pollCount} chequeos
          {secsSincePoll !== null && ` · último hace ${secsSincePoll}s`}
        </span>
        {debug.lastPollError && (
          <span className="text-rose-600 font-semibold">⚠ {debug.lastPollError}</span>
        )}
        <span className="text-slate-500">
          activos: {debug.activeCount}
          {debug.activeCount > 0 &&
            " — " +
              Object.entries(statesByCount)
                .map(([k, n]) => `${n}×${k}`)
                .join(", ")}
        </span>
        {debug.activeCount > 0 && (
          <span className="ml-auto text-violet-700 font-semibold">
            {expanded ? "▾ Ocultar detalle" : "▸ Ver detalle"}
          </span>
        )}
      </button>
      {expanded && activeEntries.length > 0 && (
        <div className="px-3 pb-2 pt-1 border-t border-slate-200">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left pr-3 py-1">Estado</th>
                <th className="text-left pr-3 py-1">Task</th>
                <th className="text-left pr-3 py-1">¿Visible aquí?</th>
                <th className="text-left pr-3 py-1">RunId / startedAt</th>
                <th className="text-left pr-3 py-1">Acción</th>
              </tr>
            </thead>
            <tbody>
              {activeEntries.map(({ taskId, info, task }) => {
                const visible = !!task;
                const colorByStatus: Record<string, string> = {
                  working: "#7c3aed",
                  ai_replied: "#06b6d4",
                  done_unreviewed: "#10b981",
                  needs_help: "#f59e0b",
                  claude_working: "#0ea5e9"
                };
                const color = colorByStatus[info.aiStatus ?? ""] ?? "#94a3b8";
                return (
                  <tr key={taskId} className="border-t border-slate-100">
                    <td className="pr-3 py-1">
                      <span
                        style={{
                          display: "inline-block",
                          padding: "1px 6px",
                          borderRadius: 4,
                          color: "#fff",
                          backgroundColor: color,
                          fontSize: 10,
                          fontWeight: 600
                        }}
                      >
                        {info.aiStatus}
                      </span>
                    </td>
                    <td className="pr-3 py-1 text-slate-700">
                      {task ? task.title.slice(0, 50) : <em className="text-slate-400">(no en este filtro)</em>}
                    </td>
                    <td className="pr-3 py-1">
                      {visible ? (
                        <span className="text-emerald-700">✓ debería verse pintada</span>
                      ) : (
                        <span className="text-slate-500">— en otro filtro/proyecto</span>
                      )}
                    </td>
                    <td className="pr-3 py-1 text-slate-500">
                      <code>{(info.runId ?? "").slice(0, 8)}</code>
                      {info.startedAt && " · " + new Date(info.startedAt).toLocaleTimeString()}
                    </td>
                    <td className="pr-3 py-1">
                      {task ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenTask(task);
                          }}
                          className="text-brand-600 hover:underline"
                        >
                          abrir
                        </button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-1 text-[10px] text-slate-500">
            Las filas con "✓ debería verse pintada" son tasks visibles en el filtro actual. Si esa task NO tiene
            badge ni borde en la card, abre DevTools y mándame screenshot.
          </div>
        </div>
      )}
    </div>
  );
}
