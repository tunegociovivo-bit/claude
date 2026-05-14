/**
 * Capa de acceso a datos.
 * - Si DATABASE_URL está configurado, intenta usar Prisma.
 * - Si falla o no está, devuelve los datos mock para que el prototipo siga vivo.
 * Esto permite que las páginas funcionen tanto en local (sin BD) como en producción.
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

export async function getClientsForUi() {
  return tryPrisma(async () => {
    const { prisma } = await import("./prisma");
    const rows = await prisma.client.findMany({
      where: { deletedAt: null },
      include: { projects: true, tasks: { where: { status: { not: "DONE" } } } },
      orderBy: { createdAt: "desc" }
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      industry: r.industry ?? "",
      contactName: r.contactName ?? "",
      email: r.email ?? "",
      phone: r.phone ?? "",
      status: r.status.toLowerCase().replace("active", "activo").replace("paused", "pausa").replace("prospect", "prospecto"),
      mrr: r.mrr,
      since: r.since?.toISOString() ?? new Date().toISOString(),
      notes: r.notes ?? "",
      _projectCount: r.projects.length,
      _openTasks: r.tasks.length
    }));
  }, mockClients.map((c) => ({ ...c, _projectCount: 0, _openTasks: 0 })));
}

export async function getTasksForUi() {
  return tryPrisma(async () => {
    const { prisma } = await import("./prisma");
    const rows = await prisma.task.findMany({
      include: { assignees: true, tags: { include: { tag: true } } },
      orderBy: { dueDate: "asc" }
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status.toLowerCase() as any,
      assigneeIds: r.assignees.map((a) => a.userId),
      projectId: r.projectId,
      clientId: r.clientId ?? undefined,
      dueDate: r.dueDate?.toISOString() ?? "",
      priority: r.priority.toLowerCase() as any,
      tags: r.tags.map((t) => t.tag.name)
    }));
  }, mockTasks);
}

export async function getDashboardData() {
  const [clients, tasks] = await Promise.all([getClientsForUi(), getTasksForUi()]);
  return {
    clients,
    tasks,
    projects: mockProjects, // se migrará en PR #3
    events: mockEvents,
    team: mockTeam
  };
}
