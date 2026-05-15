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
import BulkActionBar from "@/components/tareas/BulkActionBar";
import { statusLabelOf, statusColorOf, priorityColors } from "@/lib/mock-data";
import type { UiTask, UiProject, UiClient, UiMember } from "@/lib/db/queries";
import { LayoutGrid, List, Plus, Filter, CalendarDays, FolderPlus, GripVertical, CheckSquare, Square, Settings2, Loader2 } from "lucide-react";
import clsx from "clsx";

type KanbanColumn = { id: string; label: string; color: string; order: number; isDone?: boolean };

const COLUMN_ORDER_KEY = "kanban-column-order-v2";

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
  const urlProject = searchParams.get("project");
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [projectFilter, setProjectFilter] = useState<string>(urlProject ?? "all");

  const [tasks, setTasks] = useState<UiTask[]>(initialTasks);
  useEffect(() => setTasks(initialTasks), [initialTasks]);

  const [columns, setColumns] = useState<KanbanColumn[]>(FALLBACK_COLUMNS);
  const [columnsLoaded, setColumnsLoaded] = useState(false);
  const [userColumnOrder, setUserColumnOrder] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/v1/kanban-columns")
      .then((r) => (r.ok ? r.json() : { items: FALLBACK_COLUMNS }))
      .then((d) => {
        setColumns(d.items ?? FALLBACK_COLUMNS);
        setColumnsLoaded(true);
      });
    try {
      const saved = localStorage.getItem(COLUMN_ORDER_KEY);
      if (saved) setUserColumnOrder(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => setProjectFilter(urlProject ?? "all"), [urlProject]);

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
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

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

  const filtered = useMemo(
    () => tasks.filter((t) => projectFilter === "all" || t.projectId === projectFilter),
    [tasks, projectFilter]
  );
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const tasksByColumn = useMemo(() => {
    const map: Record<string, UiTask[]> = {};
    for (const c of orderedColumns) map[c.id] = [];
    for (const t of filtered) {
      const status = String(t.status);
      if (map[status]) map[status].push(t);
      else {
        // Tareas con status que ya no existe en config → fallback a primera columna
        const first = orderedColumns[0]?.id;
        if (first) map[first].push({ ...t, status: first });
      }
    }
    return map;
  }, [filtered, orderedColumns]);

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
    <div className="max-w-7xl mx-auto">
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
        <a
          href="/admin/columnas"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border text-xs text-slate-600 hover:text-slate-900"
          title="Configurar columnas del kanban"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Columnas
        </a>
      </div>

      {view === "kanban" ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={orderedColumns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
            {/* Móvil: scroll horizontal con columnas de ~280px (típico kanban).
                Tablet/desktop: grid uniforme. +1 columna placeholder al final
                con un botón "+" para añadir columna en línea. */}
            <KanbanGrid columnCount={Math.min(orderedColumns.length + 1, 6)}>
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
                />
              ))}
              <AddColumnButton
                existingColumns={columns}
                onCreated={async () => {
                  const r = await fetch("/api/v1/kanban-columns");
                  if (r.ok) {
                    const d = await r.json();
                    setColumns(d.items ?? []);
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
                      <span className={`text-xs px-2 py-1 rounded-md border ${statusColorOf(String(t.status), columns)}`}>
                        {statusLabelOf(String(t.status), columns)}
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
        columns={columns}
      />
      <ProjectFormModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} clients={clients} />

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

/**
 * Wrapper responsivo:
 * - Móvil: flex con scroll horizontal, columnas con ancho fijo (280px) → swipe.
 * - md+: grid con columnas que reparten ancho.
 */
function KanbanGrid({
  columnCount,
  children
}: {
  columnCount: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex md:grid gap-3 sm:gap-4 overflow-x-auto md:overflow-visible pb-2 snap-x snap-mandatory md:snap-none [&>*]:w-[280px] [&>*]:shrink-0 [&>*]:snap-start md:[&>*]:w-auto md:[&>*]:shrink"
      style={{
        gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`
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
  onCreated
}: {
  existingColumns: KanbanColumn[];
  onCreated: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("bg-violet-100 text-violet-800 border-violet-300");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const colorPresets = [
    { label: "Gris", value: "bg-slate-100 text-slate-700 border-slate-200" },
    { label: "Azul", value: "bg-sky-100 text-sky-800 border-sky-300" },
    { label: "Índigo", value: "bg-indigo-50 text-indigo-700 border-indigo-200" },
    { label: "Ámbar", value: "bg-amber-100 text-amber-800 border-amber-300" },
    { label: "Verde", value: "bg-emerald-100 text-emerald-800 border-emerald-300" },
    { label: "Rosa", value: "bg-rose-100 text-rose-800 border-rose-300" },
    { label: "Violeta", value: "bg-violet-100 text-violet-800 border-violet-300" }
  ];

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
    const r = await fetch("/api/v1/kanban-columns", {
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
  columns
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
    <div ref={setNodeRef} style={style} className="bg-slate-100/60 rounded-xl p-3 min-h-[400px] flex flex-col">
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
          <span className={`text-xs px-2 py-0.5 rounded-md border truncate ${column.color}`}>
            {column.label}
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
              selectionMode={selectionMode}
              isSelected={selectedIds.has(t.id)}
              onToggleSelected={() => onToggleSelected(t.id)}
              columns={columns}
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
  columns
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
  columns
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
}) {
  return (
    <div
      className={clsx(
        "bg-white rounded-lg border p-3 transition cursor-pointer relative",
        isOverlay ? "shadow-2xl rotate-2 border-brand-400" : "hover:shadow-sm hover:border-brand-200",
        isSelected && "border-brand-400 ring-2 ring-brand-300/50"
      )}
    >
      {selectionMode && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelected}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2 right-2 h-4 w-4"
        />
      )}
      <div className="flex items-start justify-between gap-2 mb-2 pr-6">
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
