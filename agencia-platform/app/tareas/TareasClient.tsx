"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
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
import {
  statusLabels,
  statusColors,
  priorityColors,
  type Status
} from "@/lib/mock-data";
import type { UiTask, UiProject, UiClient, UiMember } from "@/lib/db/queries";
import { LayoutGrid, List, Plus, Filter, CalendarDays, FolderPlus, GripVertical } from "lucide-react";
import clsx from "clsx";

const DEFAULT_COLUMNS: Status[] = ["todo", "in_progress", "review", "done"];
const COLUMN_ORDER_KEY = "kanban-column-order-v1";

const statusToApi: Record<Status, "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE"> = {
  todo: "TODO",
  in_progress: "IN_PROGRESS",
  review: "REVIEW",
  done: "DONE"
};

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
  const urlProject = searchParams.get("project");
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [projectFilter, setProjectFilter] = useState<string>(urlProject ?? "all");

  // Local optimistic copy of tasks so drag&drop feels instant.
  const [tasks, setTasks] = useState<UiTask[]>(initialTasks);
  useEffect(() => setTasks(initialTasks), [initialTasks]);

  // Column order persisted in localStorage.
  const [columnOrder, setColumnOrder] = useState<Status[]>(DEFAULT_COLUMNS);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLUMN_ORDER_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Status[];
        const valid = parsed.filter((s) => DEFAULT_COLUMNS.includes(s));
        const missing = DEFAULT_COLUMNS.filter((s) => !valid.includes(s));
        setColumnOrder([...valid, ...missing]);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    setProjectFilter(urlProject ?? "all");
  }, [urlProject]);

  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskStatus, setNewTaskStatus] = useState<Status | undefined>();
  const [editingTask, setEditingTask] = useState<UiTask | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const filtered = useMemo(
    () => tasks.filter((t) => projectFilter === "all" || t.projectId === projectFilter),
    [tasks, projectFilter]
  );
  const getClient = (id?: string) => clients.find((c) => c.id === id);
  const getProject = (id?: string) => projects.find((p) => p.id === id);

  function openNewTask(status?: Status) {
    setNewTaskStatus(status);
    setEditingTask(null);
    setNewTaskOpen(true);
  }
  function openEditTask(task: UiTask) {
    setEditingTask(task);
    setNewTaskStatus(undefined);
    setNewTaskOpen(true);
  }

  // distance:8 lets click events still fire on cards — drag only kicks in
  // after the pointer moves 8px, so editing-by-click and dragging coexist.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const tasksByColumn = useMemo(() => {
    const map: Record<Status, UiTask[]> = { todo: [], in_progress: [], review: [], done: [] };
    for (const t of filtered) map[t.status]?.push(t);
    return map;
  }, [filtered]);

  function persistColumnOrder(order: Status[]) {
    setColumnOrder(order);
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

    // 1. Reorder de columnas
    if (activeType === "column" && overType === "column" && active.id !== over.id) {
      const oldIdx = columnOrder.indexOf(active.id as Status);
      const newIdx = columnOrder.indexOf(over.id as Status);
      if (oldIdx === -1 || newIdx === -1) return;
      persistColumnOrder(arrayMove(columnOrder, oldIdx, newIdx));
      return;
    }

    // 2. Mover tarea
    if (activeType === "task") {
      const activeTaskId = String(active.id);
      const activeTask = tasks.find((t) => t.id === activeTaskId);
      if (!activeTask) return;

      // Determinar columna destino: si "over" es otra tarea, usamos su columna;
      // si es la propia columna (drop en zona vacía), usamos esa.
      let destColumn: Status;
      if (overType === "column") {
        destColumn = over.id as Status;
      } else if (overType === "task") {
        const overTask = tasks.find((t) => t.id === String(over.id));
        if (!overTask) return;
        destColumn = overTask.status;
      } else {
        return;
      }

      const sourceColumn = activeTask.status;

      // Reordenar localmente las tareas en cada columna afectada
      setTasks((prev) => {
        const next = prev.slice();
        const sourceList = next.filter((t) => t.status === sourceColumn).map((t) => t.id);
        const destList =
          sourceColumn === destColumn
            ? sourceList
            : next.filter((t) => t.status === destColumn).map((t) => t.id);

        // Calcular nuevo índice
        let newIndex: number;
        if (overType === "task") {
          newIndex = destList.indexOf(String(over.id));
          if (newIndex === -1) newIndex = destList.length;
        } else {
          newIndex = destList.length; // soltado en zona vacía de la columna → al final
        }

        // Actualizar estado de la tarea activa
        const taskIdx = next.findIndex((t) => t.id === activeTaskId);
        next[taskIdx] = { ...next[taskIdx], status: destColumn };

        // Recalcular order para columna destino
        const destAfter = next.filter((t) => t.status === destColumn);
        const reordered = sourceColumn === destColumn
          ? arrayMove(destAfter, destAfter.findIndex((t) => t.id === activeTaskId), newIndex)
          : (() => {
              const others = destAfter.filter((t) => t.id !== activeTaskId);
              others.splice(newIndex, 0, next[taskIdx]);
              return others;
            })();

        // Aplicar order y status nuevos a los afectados
        const updates: { id: string; order: number; status?: string }[] = [];
        reordered.forEach((t, idx) => {
          updates.push({
            id: t.id,
            order: idx,
            ...(t.id === activeTaskId ? { status: statusToApi[destColumn] } : {})
          });
        });

        // Si cambió de columna, también renumeramos la columna origen
        if (sourceColumn !== destColumn) {
          const sourceAfter = next
            .filter((t) => t.status === sourceColumn && t.id !== activeTaskId);
          sourceAfter.forEach((t, idx) => updates.push({ id: t.id, order: idx }));
        }

        // Actualizar `order` localmente en `next`
        for (const u of updates) {
          const i = next.findIndex((t) => t.id === u.id);
          if (i >= 0) {
            next[i] = {
              ...next[i],
              ...(u.status ? { status: destColumn } : {})
            };
          }
        }

        // Dispara la persistencia en background
        persistTaskReorder(updates);

        return next;
      });
    }
  }

  const activeTaskBeingDragged = activeDragId ? tasks.find((t) => t.id === activeDragId) ?? null : null;

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Tareas y proyectos"
        description="Gestiona el flujo de trabajo de toda la agencia."
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

      <div className="flex items-center gap-2 mb-5">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border text-xs">
          <Filter className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-slate-500">Proyecto:</span>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="bg-transparent font-medium focus:outline-none"
          >
            <option value="all">Todos</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {view === "kanban" ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={columnOrder} strategy={horizontalListSortingStrategy}>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {columnOrder.map((col) => (
                <KanbanColumn
                  key={col}
                  status={col}
                  tasks={tasksByColumn[col] ?? []}
                  onAddTask={() => openNewTask(col)}
                  onOpenTask={openEditTask}
                  getProject={getProject}
                  getClient={getClient}
                  team={team}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeTaskBeingDragged && (
              <TaskCard
                task={activeTaskBeingDragged}
                project={getProject(activeTaskBeingDragged.projectId)}
                client={getClient(activeTaskBeingDragged.clientId)}
                team={team}
                isOverlay
              />
            )}
          </DragOverlay>
        </DndContext>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-5 py-3">Tarea</th>
                <th className="text-left px-3 py-3">Proyecto</th>
                <th className="text-left px-3 py-3">Estado</th>
                <th className="text-left px-3 py-3">Prioridad</th>
                <th className="text-left px-3 py-3">Asignados</th>
                <th className="text-left px-3 py-3">Entrega</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((t) => {
                const project = getProject(t.projectId);
                const client = getClient(t.clientId);
                return (
                  <tr
                    key={t.id}
                    onClick={() => openEditTask(t)}
                    className="hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="px-5 py-3">
                      <div className="font-medium">{t.title}</div>
                      <div className="text-xs text-slate-500">{client?.name}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${project?.color ?? "bg-slate-300"}`} />
                        <span className="text-xs">{project?.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-xs px-2 py-1 rounded-md border ${statusColors[t.status]}`}>
                        {statusLabels[t.status]}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-xs px-2 py-1 rounded ${priorityColors[t.priority]}`}>
                        {t.priority}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <AvatarStack ids={t.assigneeIds} size={6} members={team} />
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      {new Date(t.dueDate).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
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
      />
      <ProjectFormModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} clients={clients} />

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Proyectos activos</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {projects.map((p) => {
            const client = getClient(p.clientId);
            const projectTasks = tasks.filter((t) => t.projectId === p.id);
            return (
              <div key={p.id} className="bg-white rounded-xl border p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${p.color}`} />
                  <span className="text-xs text-slate-500">{client?.name}</span>
                </div>
                <h3 className="font-semibold">{p.name}</h3>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.description}</p>
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-500">{projectTasks.length} tareas</span>
                    <span className="font-medium">{p.progress}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${p.color}`} style={{ width: `${p.progress}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// KanbanColumn — droppable + sortable (para reorder horizontal)

function KanbanColumn({
  status,
  tasks,
  onAddTask,
  onOpenTask,
  getProject,
  getClient,
  team
}: {
  status: Status;
  tasks: UiTask[];
  onAddTask: () => void;
  onOpenTask: (t: UiTask) => void;
  getProject: (id?: string) => UiProject | undefined;
  getClient: (id?: string) => UiClient | undefined;
  team: UiMember[];
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: status,
    data: { type: "column" }
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1
  };

  const taskIds = tasks.map((t) => t.id);

  return (
    <div ref={setNodeRef} style={style} className="bg-slate-100/60 rounded-xl p-3 min-h-[400px] flex flex-col">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <button
            {...attributes}
            {...listeners}
            className="text-slate-400 hover:text-slate-700 cursor-grab active:cursor-grabbing"
            aria-label="Mover columna"
            title="Arrastra para reordenar la columna"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <span className={`text-xs px-2 py-0.5 rounded-md border ${statusColors[status]}`}>
            {statusLabels[status]}
          </span>
          <span className="text-xs text-slate-500">{tasks.length}</span>
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

// ────────────────────────────────────────────────────────────────────
// SortableTask — tarjeta arrastrable

function SortableTask({
  task,
  project,
  client,
  team,
  onClick
}: {
  task: UiTask;
  project?: UiProject;
  client?: UiClient;
  team: UiMember[];
  onClick: () => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "task", status: task.status }
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={onClick}>
      <TaskCard task={task} project={project} client={client} team={team} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// TaskCard — presentación pura (reusable también en DragOverlay)

function TaskCard({
  task,
  project,
  client,
  team,
  isOverlay
}: {
  task: UiTask;
  project?: UiProject;
  client?: UiClient;
  team: UiMember[];
  isOverlay?: boolean;
}) {
  return (
    <div
      className={clsx(
        "bg-white rounded-lg border p-3 transition cursor-pointer",
        isOverlay ? "shadow-2xl rotate-2 border-brand-400" : "hover:shadow-sm hover:border-brand-200"
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium leading-snug">{task.title}</p>
        <span className={`shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${priorityColors[task.priority]}`}>
          {task.priority}
        </span>
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
