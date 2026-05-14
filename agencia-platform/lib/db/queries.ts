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

const statusToUi: Record<string, "activo" | "pausa" | "prospecto"> = {
  ACTIVE: "activo",
  PAUSED: "pausa",
  PROSPECT: "prospecto",
  CHURNED: "pausa"
};

const taskStatusToUi: Record<string, "todo" | "in_progress" | "review" | "done"> = {
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  REVIEW: "review",
  DONE: "done",
  CANCELLED: "done"
};

const priorityToUi: Record<string, "baja" | "media" | "alta"> = {
  LOW: "baja",
  MEDIUM: "media",
  HIGH: "alta",
  URGENT: "alta"
};

const eventTypeToUi: Record<string, "publicacion" | "reunion" | "deadline" | "campaña"> = {
  PUBLICATION: "publicacion",
  MEETING: "reunion",
  DEADLINE: "deadline",
  CAMPAIGN: "campaña",
  OTHER: "reunion"
};

export type UiClient = (typeof mockClients)[number];
export type UiTask = (typeof mockTasks)[number];
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
      notes: r.notes ?? ""
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
      include: { assignees: true, tags: { include: { tag: true } } },
      orderBy: { dueDate: "asc" }
    });
    return rows.map<UiTask>((r) => ({
      id: r.id,
      title: r.title,
      status: taskStatusToUi[r.status] ?? "todo",
      assigneeIds: r.assignees.map((a) => a.userId),
      projectId: r.projectId,
      clientId: r.clientId ?? undefined,
      dueDate: (r.dueDate ?? new Date()).toISOString().slice(0, 10),
      priority: priorityToUi[r.priority] ?? "media",
      tags: r.tags.map((t) => t.tag.name)
    }));
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
    const rows = await prisma.user.findMany({
      include: { memberships: { take: 1 } },
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
      color: palette[i % palette.length]
    }));
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
