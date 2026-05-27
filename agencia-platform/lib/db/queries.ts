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

// Tres niveles en la UI: URGENCIA, Alta y "media" (=Normal, sin
// pill). LOW y MEDIUM de la BD caen a "media" para que no se
// muestren con badge — antes promovíamos todo a "alta" lo que
// hacía que CADA tarea importada de Asana saliera marcada como
// urgente cuando en realidad eran de prioridad normal.
const priorityToUi: Record<string, "urgencia" | "alta" | "media"> = {
  LOW: "media",
  MEDIUM: "media",
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
  // Datos fiscales (para mostrarlos en la ficha y en facturación).
  legalName?: string | null;
  taxId?: string | null;
  fiscalAddress?: string | null;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
  countryCode?: string | null;
};
export type UiTask = (typeof mockTasks)[number] & {
  dueTime?: string; // "HH:MM" si la tarea tiene hora concreta
  dueAllDay?: boolean;
  // Multi-proyecto: lista completa de proyectos en los que aparece la
  // tarea. projectIds[0] coincide siempre con projectId (compat).
  projectIds?: string[];
  // Por cada proyecto extra (no principal), el ID de columna donde
  // la tarea aparece DENTRO de ese proyecto. La columna principal
  // sigue siendo `status`.
  extraProjectStatuses?: Record<string, string | null>;
  notifyDueRules?: string[] | null;
  // Posición dentro de su columna kanban (order ASC = más arriba).
  // Necesario para que el drag&drop dentro de una columna persista
  // visualmente al reordenar.
  order?: number;
  // URL (firmada) de la última imagen adjunta a la tarea, para mostrarla
  // como portada en la tarjeta del Kanban (estilo Asana). undefined si no
  // tiene imágenes adjuntas.
  coverImage?: string;
  /** Tareas flash (minitareas) que se muestran en la tarjeta del kanban.
   *  `urgent` resalta el ítem en rojo en la tarjeta del tablón. */
  flashTasks?: { id: string; text: string; done: boolean; urgent?: boolean }[];
};
export type UiProject = (typeof mockProjects)[number];
export type UiEvent = (typeof mockEvents)[number];
export type UiMember = (typeof mockTeam)[number];

export async function getClientsForUi(): Promise<UiClient[]> {
  return tryPrisma(async () => {
    const { prisma } = await import("./prisma");
    const { getSessionWorkspaceId } = await import("@/lib/auth");
    const workspaceId = await getSessionWorkspaceId();
    if (!workspaceId) return [];
    const rows = await prisma.client.findMany({
      where: { workspaceId, deletedAt: null } as any,
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
      kitDigital: Boolean((r as any).kitDigital),
      legalName: (r as any).legalName ?? null,
      taxId: (r as any).taxId ?? null,
      fiscalAddress: (r as any).fiscalAddress ?? null,
      postalCode: (r as any).postalCode ?? null,
      city: (r as any).city ?? null,
      province: (r as any).province ?? null,
      countryCode: (r as any).countryCode ?? null
    }));
  }, mockClients);
}

export async function getProjectsForUi(): Promise<UiProject[]> {
  return tryPrisma(async () => {
    const { prisma } = await import("./prisma");
    const { getSessionWorkspaceId } = await import("@/lib/auth");
    const workspaceId = await getSessionWorkspaceId();
    if (!workspaceId) return [];
    const rows = await prisma.project.findMany({
      where: { workspaceId, archived: false, deletedAt: null } as any,
      orderBy: { createdAt: "asc" }
    });
    return rows.map<UiProject>(
      (r) =>
        ({
          id: r.id,
          name: r.name,
          clientId: r.clientId ?? "",
          color: r.color,
          description: r.description ?? "",
          progress: r.progress,
          // Columnas kanban propias del proyecto (importadas de Asana
          // o configuradas a mano). Si null, TareasClient cae a las
          // columnas globales del workspace.
          kanbanColumns: (r as any).kanbanColumns ?? null
        } as UiProject)
    );
  }, mockProjects);
}

export async function getTasksForUi(): Promise<UiTask[]> {
  return tryPrisma(async () => {
    const { prisma } = await import("./prisma");
    const { getSessionWorkspaceId, getSessionUserId } = await import("@/lib/auth");
    const { taskVisibilityWhere } = await import("@/lib/api/task-access");
    const workspaceId = await getSessionWorkspaceId();
    if (!workspaceId) return [];
    // Visibilidad por usuario: un trabajador (no-admin) solo ve sus tareas
    // (asignadas a él) o las de proyectos a los que pertenece. ADMIN → todo.
    const userId = await getSessionUserId();
    const visibility = await taskVisibilityWhere(workspaceId, userId);
    const rows = await prisma.task.findMany({
      // Solo top-level: las subtareas viven dentro del modal de la tarea padre,
      // no como tarjetas independientes en el Kanban.
      // deletedAt: null → no incluir las que están en papelera.
      // workspaceId — sin esto traíamos las tareas de TODOS los
      // workspaces de la BD (perf disaster + tenant leak).
      where: { workspaceId, parentId: null, deletedAt: null, ...(visibility ?? {}) } as any,
      include: { assignees: true, tags: { include: { tag: true } }, extraProjects: true },
      // order ASC = más arriba en la columna. Tareas recientes (con order = 0
      // por defecto) flotan arriba, y los reorders manuales (drag&drop) ganan.
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      // Cap defensivo: con 2000+ tasks importadas de Asana, sin take
      // el SSR de /tareas tardaba 5-10s. 1000 cubre con margen el
      // tamaño típico de tablón visible.
      take: 1000
    });

    // Privacidad de encargos a Sonia: una tarea ASIGNADA a Sonia que tiene
    // un dueño humano (quien se la encargó) solo la ven sus asignados
    // humanos, no el resto de admins que miran el tablón completo. Las
    // tareas automáticas de Sonia (sin asignado humano) siguen visibles
    // para todos, igual que antes.
    const wsForAi = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true }
    });
    const aiUserId = ((wsForAi?.settings as any)?.aiAgent?.userId as string) ?? null;
    const visibleRows = !aiUserId
      ? rows
      : rows.filter((r) => {
          const aids = r.assignees.map((a) => a.userId);
          if (!aids.includes(aiUserId)) return true; // no es tarea de Sonia
          const humanAssignees = aids.filter((id) => id !== aiUserId);
          if (humanAssignees.length === 0) return true; // automática, sin dueño humano
          return !!userId && humanAssignees.includes(userId); // personal → solo sus dueños
        });

    // Portada: última imagen adjunta a cada tarea (estilo Asana). Una sola
    // query para todas las tareas visibles; nos quedamos con la más
    // reciente por tarea y firmamos su URL (R2). La firma es local (no
    // hace red), así que firmar las que tengan imagen es barato.
    const coverByTask = new Map<string, string>();
    try {
      const taskIds = rows.map((r) => r.id);
      if (taskIds.length > 0) {
        const imgs = await prisma.file.findMany({
          where: {
            workspaceId,
            targetType: "TASK",
            targetId: { in: taskIds },
            mimeType: { startsWith: "image/" }
          } as any,
          orderBy: { createdAt: "desc" },
          select: { targetId: true, s3Key: true }
        });
        const { signedDownloadUrl, isStorageEnabled } = await import("@/lib/storage/r2");
        if (isStorageEnabled()) {
          const latest: { targetId: string; s3Key: string }[] = [];
          const seen = new Set<string>();
          for (const f of imgs) {
            if (!f.targetId || seen.has(f.targetId)) continue; // imgs ya viene DESC → la primera es la última
            seen.add(f.targetId);
            latest.push({ targetId: f.targetId, s3Key: f.s3Key });
          }
          const signed = await Promise.all(
            latest.map(async (f) => ({ id: f.targetId, url: await signedDownloadUrl(f.s3Key).catch(() => null) }))
          );
          for (const s of signed) if (s.url) coverByTask.set(s.id, s.url);
        }
      }
    } catch {
      // Si falla la portada, las tarjetas se muestran sin imagen.
    }

    return visibleRows.map<UiTask>((r) => {
      const explicitAllDay = (r as any).dueAllDay;
      // Heurística: si la hora UTC almacenada NO es 00:00, hay hora
      // real, aunque dueAllDay esté a true (cubre tareas creadas antes
      // del cambio dueAllDay y también el caso en que el campo aún no
      // estuviese en BD). Si es exactamente 00:00, lo tratamos como
      // "todo el día" salvo que dueAllDay venga explícitamente false.
      const d = r.dueDate ?? null;
      let allDay: boolean;
      let timeStr: string | undefined;
      if (d) {
        const hh = d.getUTCHours();
        const mm = d.getUTCMinutes();
        if (explicitAllDay === false) {
          allDay = false;
          timeStr = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
        } else if (hh === 0 && mm === 0) {
          allDay = true;
          timeStr = undefined;
        } else {
          // Hay hora distinta de 00:00 → hay hora real aunque dueAllDay
          // no esté marcado (legacy).
          allDay = false;
          timeStr = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
        }
      } else {
        allDay = explicitAllDay ?? true;
        timeStr = undefined;
      }
      const extra = ((r as any).extraProjects ?? []) as Array<{ projectId: string; status: string | null }>;
      const projectIds = [r.projectId, ...extra.map((e) => e.projectId).filter((id) => id !== r.projectId)];
      // Mapa projectId → status para los extras. La tarea cae en esa
      // columna cuando estás filtrando por ese proyecto secundario.
      const extraProjectStatuses: Record<string, string | null> = {};
      for (const e of extra) if (e.projectId !== r.projectId) extraProjectStatuses[e.projectId] = e.status;
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
        extraProjectStatuses,
        clientId: r.clientId ?? undefined,
        // Si la tarea no tiene fecha, NO inventamos una (antes ponía
        // "hoy" como fallback, lo que hacía que TODAS las tareas
        // importadas de Asana sin due aparecieran con la fecha del
        // import). El UI maneja undefined correctamente.
        dueDate: r.dueDate ? r.dueDate.toISOString().slice(0, 10) : (undefined as any),
        dueTime: timeStr,
        dueAllDay: allDay,
        priority: priorityToUi[r.priority] ?? "media",
        tags: r.tags.map((t) => t.tag.name),
        notifyDueRules: (r as any).notifyDueRules ?? null,
        order: (r as any).order ?? 0,
        coverImage: coverByTask.get(r.id),
        flashTasks: Array.isArray((r as any).flashTasks) ? ((r as any).flashTasks as any[]) : []
      };
    });
  }, mockTasks);
}

export async function getEventsForUi(userId?: string | null): Promise<UiEvent[]> {
  return tryPrisma(async () => {
    const { prisma } = await import("./prisma");
    // Privacidad: los eventos personales (ownerUserId != null) solo los ve su
    // dueño. Los compartidos (ownerUserId null) los ve todo el mundo. Si no
    // hay userId, solo se devuelven los compartidos.
    const rows = await prisma.calendarEvent.findMany({
      where: { OR: [{ ownerUserId: null }, ...(userId ? [{ ownerUserId: userId }] : [])] } as any,
      orderBy: { startAt: "asc" }
    });
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
  const { getSessionUserId } = await import("@/lib/auth");
  const dashUserId = await getSessionUserId();
  const [clients, tasks, projects, events, team] = await Promise.all([
    getClientsForUi(),
    getTasksForUi(),
    getProjectsForUi(),
    getEventsForUi(dashUserId),
    getTeamForUi()
  ]);
  return { clients, tasks, projects, events, team };
}
