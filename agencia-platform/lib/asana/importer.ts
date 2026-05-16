/**
 * Importer Asana → Agencia Hub.
 * Idempotente: se identifica todo por `asanaId` (o por email para usuarios).
 * Estados: PENDING → RUNNING → COMPLETED | FAILED.
 * Estadísticas guardadas en `AsanaImport.stats`.
 */

import { prisma } from "@/lib/db/prisma";
import { AsanaClient, type AsanaTask } from "./client";
import { TaskPriority } from "@prisma/client";
import { detectPriorityFromCustomFields } from "./priority";
import { importAttachmentsForTask } from "./attachments";
import { toTipTapDoc } from "@/lib/comments/body";

// Antes TaskStatus era enum en Prisma; ahora es string libre para soportar
// columnas custom del Kanban. Mantenemos los valores por defecto como
// constantes string para usar dentro del importer.
type TaskStatus = "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE" | "CANCELLED";
const TaskStatus = {
  TODO: "TODO" as const,
  IN_PROGRESS: "IN_PROGRESS" as const,
  REVIEW: "REVIEW" as const,
  DONE: "DONE" as const,
  CANCELLED: "CANCELLED" as const
};

type ImportOptions = {
  workspaceId: string; // workspace local
  asanaWorkspaceGid: string;
  token: string;
  projectGids?: string[]; // si se especifica, sólo esos proyectos
};

type Stats = {
  users: number;
  projects: number;
  tasks: number;
  subtasks: number;
  comments: number;
  tags: number;
  // Adjuntos descargados desde Asana y re-subidos al storage del Hub.
  attachmentsImported: number;
  // Adjuntos externos (gdrive/dropbox/etc.) referenciados como link
  // pero no descargados (no tenemos download_url).
  attachmentsExternal: number;
  attachmentsFailed: number;
  // Comentarios saltados porque ya existían (por asanaId).
  commentsSkipped: number;
  // Errores parciales: no rompen el job, pero se loggean.
  warnings: string[];
  skipped: number;
};

function statusFromSectionName(name?: string | null): TaskStatus {
  if (!name) return TaskStatus.TODO;
  const n = name.toLowerCase();
  if (/(hecho|done|complete|publicado|finalizad)/.test(n)) return TaskStatus.DONE;
  if (/(revisi|review|approval)/.test(n)) return TaskStatus.REVIEW;
  if (/(curso|progress|doing|trabaj)/.test(n)) return TaskStatus.IN_PROGRESS;
  if (/(cancel|archived|descart)/.test(n)) return TaskStatus.CANCELLED;
  return TaskStatus.TODO;
}

// Convierte "Creatividades RRSS" → "CREATIVIDADES_RRSS" para usar
// como id de KanbanColumn (debe coincidir con el regex que valida
// /api/v1/kanban-columns: /^[A-Z0-9_]+$/).
function slugifyColumnId(name: string): string {
  return name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

// Paleta de colores para asignar a las columnas creadas desde
// secciones de Asana. Mismo set que /admin/columnas + COLUMN_COLOR_PRESETS
// de TareasClient — repetimos por orden para que columnas
// secuenciales se distingan visualmente.
const COLUMN_PALETTE: string[] = [
  "bg-slate-100 text-slate-700 border-slate-200",
  "bg-sky-100 text-sky-800 border-sky-300",
  "bg-indigo-50 text-indigo-700 border-indigo-200",
  "bg-amber-100 text-amber-800 border-amber-300",
  "bg-emerald-100 text-emerald-800 border-emerald-300",
  "bg-rose-100 text-rose-800 border-rose-300",
  "bg-violet-100 text-violet-800 border-violet-300"
];

function findDoneColumnId(
  info?: { sections: Map<string, { name: string; columnId: string }> }
): string | null {
  if (!info) return null;
  for (const s of info.sections.values()) {
    if (/(hecho|done|complete|publicad|finalizad)/i.test(s.name)) return s.columnId;
  }
  return null;
}

export async function startAsanaImport(opts: ImportOptions): Promise<string> {
  const job = await prisma.asanaImport.create({
    data: {
      workspaceId: opts.workspaceId,
      status: "PENDING",
      stats: emptyStats() as any
    }
  });

  // Lanzar en background; no esperamos al request
  runImport(job.id, opts).catch((err) => {
    console.error("[asana-import] fallo no capturado", err);
    prisma.asanaImport
      .update({
        where: { id: job.id },
        data: { status: "FAILED", finishedAt: new Date(), errorMsg: String(err?.message ?? err) }
      })
      .catch(() => {});
  });

  return job.id;
}

function emptyStats(): Stats {
  return {
    users: 0,
    projects: 0,
    tasks: 0,
    subtasks: 0,
    comments: 0,
    tags: 0,
    attachmentsImported: 0,
    attachmentsExternal: 0,
    attachmentsFailed: 0,
    commentsSkipped: 0,
    warnings: [],
    skipped: 0
  };
}

async function runImport(jobId: string, opts: ImportOptions) {
  const stats: Stats = emptyStats();
  const client = new AsanaClient(opts.token);

  await prisma.asanaImport.update({ where: { id: jobId }, data: { status: "RUNNING" } });

  try {
    // ─── Usuarios ─────────────────────────────────────────────────────────────
    const userByGid = new Map<string, string>(); // asanaGid → local userId
    for await (const u of client.workspaceUsers(opts.asanaWorkspaceGid)) {
      if (!u.email) {
        stats.skipped++;
        continue;
      }
      const existing = await prisma.user.findUnique({ where: { email: u.email } });
      let userId: string;
      if (existing) {
        userId = existing.id;
      } else {
        const created = await prisma.user.create({
          data: {
            email: u.email,
            name: u.name,
            memberships: { create: { workspaceId: opts.workspaceId, role: "MEMBER" } }
          }
        });
        userId = created.id;
        stats.users++;
      }
      userByGid.set(u.gid, userId);
    }

    // ─── Proyectos + secciones (= columnas kanban del proyecto) ─────────────
    // En Asana las secciones del proyecto (TAREAS, REUNIONES, SPLITS,
    // CREATIVIDADES, CAMBIOS, …) son LAS COLUMNAS del tablero. Las
    // traemos como `Project.kanbanColumns` para que el Hub reproduzca
    // el tablero original cuando filtras por ese proyecto.
    //
    // sectionGid → { name, columnId } — columnId es el slug que usaremos
    // como `status` en cada tarea para que caiga en la columna correcta.
    type SectionInfo = { name: string; columnId: string };
    type ProjectInfo = { localId: string; sections: Map<string, SectionInfo> };
    const projectByGid = new Map<string, ProjectInfo>();

    for await (const p of client.workspaceProjects(opts.asanaWorkspaceGid)) {
      if (opts.projectGids && !opts.projectGids.includes(p.gid)) continue;
      let local = await prisma.project.findUnique({ where: { asanaId: p.gid } });

      // Recolectar secciones del proyecto en Asana, en su orden.
      const sectionsList: { gid: string; name: string }[] = [];
      for await (const s of client.projectSections(p.gid)) sectionsList.push({ gid: s.gid, name: s.name });

      // Construir las kanbanColumns: id derivado del slug del nombre.
      const usedIds = new Set<string>();
      const palette = COLUMN_PALETTE;
      const kanbanColumns = sectionsList.map((s, idx) => {
        let id = slugifyColumnId(s.name);
        if (!id) id = `COL_${idx + 1}`;
        // Dedupe por si dos secciones generan el mismo slug.
        let base = id;
        let n = 2;
        while (usedIds.has(id)) {
          id = `${base}_${n}`;
          n++;
        }
        usedIds.add(id);
        const color = palette[idx % palette.length];
        const isDone = /(hecho|done|complete|publicad|finalizad)/i.test(s.name);
        return { id, label: s.name, color, order: idx, ...(isDone ? { isDone: true } : {}) };
      });

      if (!local) {
        local = await prisma.project.create({
          data: {
            workspaceId: opts.workspaceId,
            name: p.name,
            description: p.notes ?? "",
            archived: !!p.archived,
            color: "bg-brand-500",
            asanaId: p.gid,
            kanbanColumns: kanbanColumns as any
          } as any
        });
        stats.projects++;
      } else {
        await prisma.project.update({
          where: { id: local.id },
          data: {
            name: p.name,
            description: p.notes ?? "",
            archived: !!p.archived,
            // Reemplazamos las columnas en cada import — son la fuente
            // de verdad de Asana. Si el user editó nombres en el Hub
            // se pierden, pero a cambio queda alineado con Asana
            // mientras la migración esté en curso.
            kanbanColumns: kanbanColumns as any
          } as any
        });
      }

      const sections = new Map<string, SectionInfo>();
      sectionsList.forEach((s, i) => {
        sections.set(s.gid, { name: s.name, columnId: kanbanColumns[i].id });
      });
      projectByGid.set(p.gid, { localId: local.id, sections });

      await persistStats(jobId, stats);
    }

    // ─── Tareas (y subtareas, comentarios, tags) ──────────────────────────────
    const taskByGid = new Map<string, string>(); // asanaGid → local taskId
    const tagByName = new Map<string, string>(); // name → local tagId

    async function ensureTag(name: string) {
      const existing = tagByName.get(name);
      if (existing) return existing;
      const t = await prisma.tag.upsert({
        where: { workspaceId_name: { workspaceId: opts.workspaceId, name } },
        update: {},
        create: { workspaceId: opts.workspaceId, name }
      });
      tagByName.set(name, t.id);
      return t.id;
    }

    /**
     * Si una story de Asana cita a un usuario que NO está en el map
     * (porque era un guest, un member que ya no está, o porque la
     * paginación de users no lo devolvió), lo creamos al vuelo en
     * estado "pendiente de verificar" — el user nos pidió no perder
     * ningún comentario. Sólo se hace si tenemos email.
     */
    async function ensureUser(gid: string, name?: string | null, email?: string | null): Promise<string | null> {
      const cached = userByGid.get(gid);
      if (cached) return cached;
      if (!email) return null;
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        userByGid.set(gid, existing.id);
        return existing.id;
      }
      const created = await prisma.user.create({
        data: {
          email,
          name: name ?? email,
          // emailVerified=null = "pendiente de verificar" funcionalmente
          memberships: { create: { workspaceId: opts.workspaceId, role: "GUEST" } }
        }
      });
      userByGid.set(gid, created.id);
      stats.users++;
      return created.id;
    }

    async function upsertTask(
      t: AsanaTask,
      projectLocalId: string,
      currentProjectGid: string,
      sectionGid?: string | null,
      parentGid?: string
    ) {
      // El status de la tarea es el ID de la columna del proyecto que
      // se corresponde con la sección de Asana. Así la tarea cae en
      // SU columna original (TAREAS, REUNIONES, SPLITS...) en lugar
      // del genérico TODO. Si la tarea está completed, va a la primera
      // columna marcada isDone (o "HECHO" en su nombre).
      const projectInfo = projectByGid.get(currentProjectGid);
      const sectionInfo = sectionGid ? projectInfo?.sections.get(sectionGid) : null;
      let status: string;
      if (t.completed) {
        const doneCol = findDoneColumnId(projectInfo);
        status = doneCol ?? sectionInfo?.columnId ?? TaskStatus.DONE;
      } else {
        status = sectionInfo?.columnId ?? statusFromSectionName(sectionInfo?.name) ?? TaskStatus.TODO;
      }
      const due = t.due_at || t.due_on ? new Date(t.due_at ?? t.due_on!) : null;
      const priority = detectPriorityFromCustomFields(t.custom_fields);
      const parentLocal = parentGid ? taskByGid.get(parentGid) : null;

      let local = await prisma.task.findUnique({ where: { asanaId: t.gid } });
      if (local) {
        local = await prisma.task.update({
          where: { id: local.id },
          data: {
            title: t.name,
            description: t.notes ?? "",
            status,
            priority,
            dueDate: due,
            completedAt: t.completed_at ? new Date(t.completed_at) : null,
            parentId: parentLocal ?? null,
            asanaPermalink: t.permalink_url ?? null,
            asanaCustomFields: (t.custom_fields ?? null) as any
          } as any
        });
      } else {
        local = await prisma.task.create({
          data: {
            workspaceId: opts.workspaceId,
            projectId: projectLocalId,
            parentId: parentLocal ?? null,
            title: t.name,
            description: t.notes ?? "",
            status,
            priority,
            dueDate: due,
            completedAt: t.completed_at ? new Date(t.completed_at) : null,
            asanaId: t.gid,
            asanaPermalink: t.permalink_url ?? null,
            asanaCustomFields: (t.custom_fields ?? null) as any
          } as any
        });
      }
      taskByGid.set(t.gid, local.id);

      // Asignado oficial + followers (todos van a TaskAssignee para
      // no perder visibilidad en la migración: en el Hub no hay
      // distinción "follower vs assignee", lo que en Asana eran
      // followers se ven en el Hub como co-asignados).
      const assigneeGids = new Set<string>();
      if (t.assignee?.gid) assigneeGids.add(t.assignee.gid);
      for (const f of t.followers ?? []) {
        if (f?.gid) assigneeGids.add(f.gid);
      }
      for (const gid of assigneeGids) {
        // Si el user no está en el map por algún motivo, lo creamos
        // al vuelo como GUEST (mismo flow que para autores de comments).
        const userInfo =
          t.assignee?.gid === gid
            ? t.assignee
            : t.followers?.find((f) => f.gid === gid);
        const uid = await ensureUser(gid, userInfo?.name, userInfo?.email);
        if (!uid) continue;
        await prisma.taskAssignee.upsert({
          where: { taskId_userId: { taskId: local.id, userId: uid } },
          update: {},
          create: { taskId: local.id, userId: uid }
        });
      }

      // Multi-proyecto: si la tarea está en N proyectos de Asana, el
      // que estamos procesando ahora va a `projectId` (principal); el
      // resto los enlazamos vía TaskProject para que aparezca en
      // varios kanbans sin duplicar el registro. Solo añadimos
      // proyectos de Asana que ya hemos importado (estén en
      // projectByGid del bucle); los demás se enlazarán en una
      // pasada posterior si están en el mismo job.
      const otherProjectGids = (t.memberships ?? [])
        .map((m) => m.project?.gid)
        .filter((gid): gid is string => !!gid && gid !== currentProjectGid);
      for (const otherGid of otherProjectGids) {
        const other = projectByGid.get(otherGid);
        if (!other || other.localId === projectLocalId) continue;
        await prisma.taskProject
          .upsert({
            where: { taskId_projectId: { taskId: local.id, projectId: other.localId } },
            update: {},
            create: { taskId: local.id, projectId: other.localId }
          })
          .catch(() => {});
      }

      // Tags reales de Asana. La sección YA no se duplica como tag
      // porque ahora se materializa como columna del proyecto
      // (Project.kanbanColumns) y la tarea cae en su columna correcta
      // vía `status`.
      for (const name of t.tags?.map((x) => x.name) ?? []) {
        const tagId = await ensureTag(name);
        await prisma.taskTag.upsert({
          where: { taskId_tagId: { taskId: local.id, tagId } },
          update: {},
          create: { taskId: local.id, tagId }
        });
        stats.tags++;
      }

      // Comentarios (stories tipo "comment_added"). Idempotente por
      // Comment.asanaId == story.gid. Si el autor no estaba en el
      // map pero tiene email, lo creamos como GUEST pendiente.
      for await (const story of client.taskStories(t.gid)) {
        if (story.resource_subtype !== "comment_added") continue;
        if (!story.text) continue;
        if (!story.created_by?.gid) continue;
        const authorId = await ensureUser(
          story.created_by.gid,
          story.created_by.name,
          story.created_by.email
        );
        if (!authorId) {
          stats.warnings.push(`Comentario sin email del autor: tarea ${t.name} → autor ${story.created_by.name ?? "?"}`);
          continue;
        }
        // Idempotencia por asanaId del story.
        const exists = await prisma.comment.findUnique({ where: { asanaId: story.gid } });
        if (exists) {
          stats.commentsSkipped++;
          continue;
        }
        // Comentarios de Asana son texto plano. Guardamos también el
        // bodyJson (envoltorio TipTap) para que la UI rich los pinte
        // sin lazy migration al primer GET.
        const importedDoc = toTipTapDoc(story.text);
        await prisma.comment.create({
          data: {
            workspaceId: opts.workspaceId,
            authorId,
            targetType: "TASK",
            targetId: local.id,
            body: story.text,
            bodyJson: importedDoc as any,
            asanaId: story.gid,
            createdAt: new Date(story.created_at)
          }
        });
        stats.comments++;
      }

      // Adjuntos: descarga + re-sube a R2. Idempotente por File.asanaId.
      try {
        const r = await importAttachmentsForTask({
          client,
          workspaceId: opts.workspaceId,
          taskLocalId: local.id,
          taskAsanaGid: t.gid
        });
        stats.attachmentsImported += r.imported;
        stats.attachmentsExternal += r.externalLinked;
        stats.attachmentsFailed += r.failed;
        if (r.errors.length > 0) {
          stats.warnings.push(`Adjuntos en "${t.name}": ${r.errors.slice(0, 3).join(" | ")}`);
        }
      } catch (e: any) {
        stats.attachmentsFailed++;
        stats.warnings.push(`Adjuntos de "${t.name}" fallaron: ${String(e?.message ?? e).slice(0, 120)}`);
      }

      return local.id;
    }

    for (const [projectGid, info] of projectByGid) {
      for await (const t of client.projectTasks(projectGid)) {
        const sectionGid = t.memberships?.find((m) => m.project.gid === projectGid)?.section?.gid ?? null;
        await upsertTask(t, info.localId, projectGid, sectionGid);
        stats.tasks++;

        // Subtareas — heredan el proyecto principal del padre y su
        // sección (las subtareas en Asana no tienen sección propia).
        for await (const sub of client.taskSubtasks(t.gid)) {
          await upsertTask(sub, info.localId, projectGid, sectionGid, t.gid);
          stats.subtasks++;
        }
      }
      await persistStats(jobId, stats);
    }

    await prisma.asanaImport.update({
      where: { id: jobId },
      data: { status: "COMPLETED", finishedAt: new Date(), stats: stats as any }
    });
  } catch (err: any) {
    await prisma.asanaImport.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMsg: String(err?.message ?? err),
        stats: stats as any
      }
    });
  }
}

async function persistStats(jobId: string, stats: Stats) {
  await prisma.asanaImport.update({ where: { id: jobId }, data: { stats: stats as any } });
}
