/**
 * Capa de acceso a datos para las páginas server.
 * - Si DATABASE_URL está, usa Prisma.
 * - Si falla / no hay BD, devuelve mock data para que la UI siga viva.
 * Devuelve formas compatibles con los componentes existentes del prototipo.
 */

import {
  clients as mockClients,
  projects as mockProjects,
  tasks as mockTasks,
  events as mockEvents,
  team as mockTeam,
  docs as mockDocs
} from "@/lib/mock-data";

const hasDb = Boolean(process.env.DATABASE_URL);

async function tryPrisma<T, F>(fn: () => Promise<T>, fallback: F): Promise<T | F> {
  if (!hasDb) return fallback;
  try {
    return await fn();
  } catch (e) {
    console.warn("[queries] Prisma falló, usando mock:", (e as Error).message);
    return fallback;
  }
}

// En la UI sólo hay 2 estados: activo / pausa (label visible: "no activo").
// PROSPECT y CHURNED de BD se mapean a "pausa" → quedan al final del
// listado, como pidió el usuario.
const statusToUi: Record<string, "activo" | "pausa"> = {
  ACTIVE: "activo",
  PAUSED: "pausa",
  PROSPECT: "pausa",
  CHURNED: "pausa"
};

const taskStatusToUi: Record<string, "todo" | "in_progress" | "review" | "done"> = {
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  REVIEW: "review",
  DONE: "done",
  CANCELLED: "done"
};

// Sólo exponemos dos niveles en la UI: URGENCIA y Alta. Las prioridades
// LOW/MEDIUM legacy se promueven a "alta" para no perder visibilidad de
// tareas creadas antes del cambio.
const priorityToUi: Record<string, "urgencia" | "alta"> = {
  LOW: "alta",
  MEDIUM: "alta",
  HIGH: "alta",
  URGENT: "urgencia"
};

const eventTypeToUi: Record<string, "publicacion" | "reunion" | "deadline" | "campaña"> = {
  PUBLICATION: "publicacion",
  MEETING: "reunion",
  DEADLINE: "deadline",
  CAMPAIGN: "campaña",
  OTHER: "reunion"
};

export type UiClient = (typeof mockClients)[number] & {
  prioridad?: "ALTA" | "NORMAL" | "BAJA";
  servicios?: string[];
  kitDigital?: boolean;
};
export type UiTask = (typeof mockTasks)[number] & {
  dueTime?: string; // "HH:MM" si la tarea tiene hora concreta
  dueAllDay?: boolean;
  // Multi-proyecto: lista completa de proyectos en los que aparece la
  // tarea. projectIds[0] coincide siempre con projectId (compat).
  projectIds?: string[];
  notifyDueRules?: string[] | null;
};
export type UiProject = (typeof mockProjects)[number];
export type UiEvent = (typeof mockEvents)[number];
export type UiMember = (typeof mockTeam)[number];

export async function getClientsForUi(): Promise<UiClient[]> {
  return tryPrisma(async () => {
    const { prisma } = await import("./prisma");
    const rows = await prisma.client.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" }
    });
    return rows.map<UiClient>((r) => ({
      id: r.id,
      name: r.name,
      industry: r.industry ?? "",
      contactName: r.contactName ?? "",
      email: r.email ?? "",
      phone: r.phone ?? "",
      status: statusToUi[r.status] ?? "activo",
      mrr: r.mrr,
      since: (r.since ?? new Date()).toISOString().slice(0, 10),
      notes: r.notes ?? "",
      prioridad: ((r as any).prioridad as "ALTA" | "NORMAL" | "BAJA" | undefined) ?? "NORMAL",
      servicios: Array.isArray((r as any).servicios) ? ((r as any).servicios as string[]) : [],
      kitDigital: Boolean((r as any).kitDigital)
    }));
  }, mockClients);
}

export async function getProjectsForUi(): Promise<UiProject[]> {
  return tryPrisma(async () => {
    const { prisma } = await import("./prisma");
    const rows = await prisma.project.findMany({
      where: { archived: false },
      orderBy: { createdAt: "asc" }
    });
    return rows.map<UiProject>((r) => ({
      id: r.id,
      name: r.name,
      clientId: r.clientId ?? "",
      color: r.color,
      description: r.description ?? "",
      progress: r.progress
    }));
  }, mockProjects);
}

export async function getTasksForUi(): Promise<UiTask[]> {
  return tryPrisma(async () => {
    const { prisma } = await import("./prisma");
    const rows = await prisma.task.findMany({
      // Solo top-level: las subtareas viven dentro del modal de la tarea padre,
      // no como tarjetas independientes en el Kanban.
      where: { parentId: null },
      include: { assignees: true, tags: { include: { tag: true } }, extraProjects: true },
      // order ASC = más arriba en la columna. Tareas recientes (con order = 0
      // por defecto) flotan arriba, y los reorders manuales (drag&drop) ganan.
      orderBy: [{ order: "asc" }, { createdAt: "desc" }]
    });
    return rows.map<UiTask>((r) => {
      const allDay = (r as any).dueAllDay ?? true;
      const extra = ((r as any).extraProjects ?? []) as Array<{ projectId: string }>;
      const projectIds = [r.projectId, ...extra.map((e) => e.projectId).filter((id) => id !== r.projectId)];
      return {
        id: r.id,
        title: r.title,
        // Devolvemos el ID de columna tal cual está en BD. Por defecto
        // "TODO" / "IN_PROGRESS" / "REVIEW" / "DONE", pero puede ser cualquier
        // ID definido en workspace.settings.kanban.columns.
        status: r.status as any,
        assigneeIds: r.assignees.map((a) => a.userId),
        projectId: r.projectId,
        projectIds,
        clientId: r.clientId ?? undefined,
        dueDate: (r.dueDate ?? new Date()).toISOString().slice(0, 10),
        dueTime: r.dueDate && !allDay ? r.dueDate.toISOString().slice(11, 16) : undefined,
        dueAllDay: allDay,
        priority: priorityToUi[r.priority] ?? "alta",
        tags: r.tags.map((t) => t.tag.name),
        notifyDueRules: (r as any).notifyDueRules ?? null
      };
    });
  }, mockTasks);
}

export async function getEventsForUi(): Promise<UiEvent[]> {
  return tryPrisma(async () => {
    const { prisma } = await import("./prisma");
    const rows = await prisma.calendarEvent.findMany({ orderBy: { startAt: "asc" } });
    return rows.map<UiEvent>((r) => ({
      id: r.id,
      title: r.title,
      date: r.startAt.toISOString().slice(0, 10),
      time: r.allDay ? undefined : r.startAt.toISOString().slice(11, 16),
      type: eventTypeToUi[r.type] ?? "reunion",
      clientId: r.clientId ?? undefined
    }));
  }, mockEvents);
}

export async function getTeamForUi(): Promise<UiMember[]> {
  return tryPrisma(async () => {
    const { prisma } = await import("./prisma");
    const { getSessionWorkspaceId } = await import("@/lib/auth");
    const workspaceId = await getSessionWorkspaceId();

    // Solo usuarios que pertenecen al workspace ACTUAL. Cuando un admin
    // elimina a un trabajador en /admin/usuarios se borra el Membership,
    // así esa persona desaparece de aquí inmediatamente (antes seguía
    // apareciendo en /inicio Equipo porque hacíamos findMany global).
    if (!workspaceId) return [];

    const rows = await prisma.user.findMany({
      where: { memberships: { some: { workspaceId } } },
      include: { memberships: { where: { workspaceId }, take: 1 } },
      orderBy: { createdAt: "asc" }
    });
    const palette = ["bg-rose-500", "bg-indigo-500", "bg-emerald-500", "bg-amber-500", "bg-sky-500", "bg-purple-500"];
    return rows.map<UiMember>((u, i) => ({
      id: u.id,
      name: u.name ?? u.email,
      initials: (u.name ?? u.email)
        .split(/\s+/)
        .slice(0, 2)
        .map((s) => s[0]?.toUpperCase() ?? "")
        .join(""),
      role: u.memberships[0]?.role === "ADMIN" ? "Admin" : "Miembro",
      color: palette[i % palette.length],
      // Imagen del usuario (foto de perfil subida en /perfil o por admin)
      image: u.image ?? undefined
    } as UiMember));
  }, mockTeam);
}

export async function getDashboardData() {
  const [clients, tasks, projects, events, team] = await Promise.all([
    getClientsForUi(),
    getTasksForUi(),
    getProjectsForUi(),
    getEventsForUi(),
    getTeamForUi()
  ]);
  return { clients, tasks, projects, events, team };
}
