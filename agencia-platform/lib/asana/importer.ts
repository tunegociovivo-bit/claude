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

    // ─── Proyectos + secciones ────────────────────────────────────────────────
    type ProjectInfo = { localId: string; sections: Map<string, string> }; // sectionGid → sectionName
    const projectByGid = new Map<string, ProjectInfo>();

    for await (const p of client.workspaceProjects(opts.asanaWorkspaceGid)) {
      if (opts.projectGids && !opts.projectGids.includes(p.gid)) continue;
      let local = await prisma.project.findUnique({ where: { asanaId: p.gid } });
      if (!local) {
        local = await prisma.project.create({
          data: {
            workspaceId: opts.workspaceId,
            name: p.name,
            description: p.notes ?? "",
            archived: !!p.archived,
            color: "bg-brand-500",
            asanaId: p.gid
          }
        });
        stats.projects++;
      } else {
        await prisma.project.update({
          where: { id: local.id },
          data: { name: p.name, description: p.notes ?? "", archived: !!p.archived }
        });
      }

      const sections = new Map<string, string>();
      for await (const s of client.projectSections(p.gid)) sections.set(s.gid, s.name);
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

    async function upsertTask(t: AsanaTask, projectLocalId: string, sectionName?: string | null, parentGid?: string) {
      const status = t.completed ? TaskStatus.DONE : statusFromSectionName(sectionName);
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

      // Asignados
      if (t.assignee?.email) {
        const uid = userByGid.get(t.assignee.gid);
        if (uid) {
          await prisma.taskAssignee.upsert({
            where: { taskId_userId: { taskId: local.id, userId: uid } },
            update: {},
            create: { taskId: local.id, userId: uid }
          });
        }
      }

      // Tags + sección como tag suelto (no perdemos info)
      const tagNames = [
        ...(t.tags?.map((x) => x.name) ?? []),
        ...(sectionName ? [`Sección: ${sectionName}`] : [])
      ];
      for (const name of tagNames) {
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
        await prisma.comment.create({
          data: {
            workspaceId: opts.workspaceId,
            authorId,
            targetType: "TASK",
            targetId: local.id,
            body: story.text,
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
        const sectionName = t.memberships?.find((m) => m.project.gid === projectGid)?.section?.name ?? null;
        await upsertTask(t, info.localId, sectionName);
        stats.tasks++;

        // subtareas (recursivas en 1 nivel; las anidadas se pueden añadir más tarde)
        for await (const sub of client.taskSubtasks(t.gid)) {
          await upsertTask(sub, info.localId, sectionName, t.gid);
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
