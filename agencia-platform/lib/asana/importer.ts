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
import { parseAsanaCommentToTipTap } from "./comment-parser";
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

  await prisma.asanaImport.update({
    where: { id: jobId },
    data: { status: "RUNNING", lastHeartbeatAt: new Date(), currentStage: "Iniciando" }
  });

  try {
    // ─── Usuarios ─────────────────────────────────────────────────────────────
    await heartbeat(jobId, "Leyendo usuarios de Asana");
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

    await heartbeat(jobId, "Leyendo proyectos y secciones");
    for await (const p of client.workspaceProjects(opts.asanaWorkspaceGid)) {
      if (opts.projectGids && !opts.projectGids.includes(p.gid)) continue;
      let local = await prisma.project.findUnique({ where: { asanaId: p.gid } });

      // Recolectar secciones del proyecto en Asana, en su orden.
      const sectionsList: { gid: string; name: string }[] = [];
      for await (const s of client.projectSections(p.gid)) sectionsList.push({ gid: s.gid, name: s.name });

      // Si Asana no devuelve secciones (proyecto list-view sin
      // estructura, o respuesta vacía por algún motivo), AÑADIMOS
      // una columna default "TAREAS" para que el tablero del proyecto
      // tenga al menos una columna usable. Sin esto, kanbanColumns
      // quedaba [], el UI caía a las columnas default del workspace
      // (TODO/IN_PROGRESS/REVIEW/DONE), y todas las tareas — sin
      // sección en Asana — caían al genérico TODO. Resultado: todas
      // las tareas amontonadas en "Por hacer".
      if (sectionsList.length === 0) {
        sectionsList.push({ gid: `__synthetic_${p.gid}`, name: "Tareas" });
      }

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
        // NOTA: nuevos proyectos importados quedan archived=false
        // SIEMPRE, aunque en Asana estén archivados. El user los está
        // tirando explícitamente al Hub porque quiere verlos — si
        // Asana los tenía archivados era organización suya allí, no
        // un "borrado". El user puede archivar en el Hub más tarde
        // si quiere, y futuros re-imports respetarán esa decisión.
        local = await prisma.project.create({
          data: {
            workspaceId: opts.workspaceId,
            name: p.name,
            description: p.notes ?? "",
            archived: false,
            color: "bg-brand-500",
            asanaId: p.gid,
            kanbanColumns: kanbanColumns as any
          } as any
        });
        stats.projects++;
      } else {
        // Para proyectos ya importados, NO sobreescribimos `archived`:
        // respetamos el valor que el user puso en el Hub. Si Asana lo
        // archivó pero en el Hub lo tenemos vivo, sigue vivo. Y al
        // revés: si en el Hub lo archivaron, no lo re-activamos.
        await prisma.project.update({
          where: { id: local.id },
          data: {
            name: p.name,
            description: p.notes ?? "",
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

      // Si Asana NO devuelve email (cuenta privada, sin scope adecuado,
      // o cliente externo) — antes devolvíamos null y los comentarios
      // se descartaban silenciosamente. Ahora fabricamos un email
      // sintético estable basado en el gid de Asana, así dos
      // comentarios del mismo autor sin email quedan atribuidos al
      // mismo usuario placeholder. Más adelante el admin puede
      // fusionarlos con cuentas reales si lo necesita.
      const effectiveEmail = email ?? `asana-${gid}@imported.local`;
      const effectiveName = name ?? (email ? email : `Usuario Asana ${gid.slice(-6)}`);

      const existing = await prisma.user.findUnique({ where: { email: effectiveEmail } });
      if (existing) {
        userByGid.set(gid, existing.id);
        return existing.id;
      }
      const created = await prisma.user.create({
        data: {
          email: effectiveEmail,
          name: effectiveName,
          // emailVerified=null = "pendiente de verificar" funcionalmente
          memberships: { create: { workspaceId: opts.workspaceId, role: "GUEST" } }
        }
      });
      userByGid.set(gid, created.id);
      stats.users++;
      if (!email) {
        // Solo trackeamos esto como warning si es la primera vez que vemos
        // este gid — para no inundar stats.warnings con miles de líneas.
        stats.warnings.push(
          `Asana no expuso email del autor ${name ?? gid}; creado usuario placeholder ${effectiveEmail}`
        );
      }
      return created.id;
    }

    async function upsertTask(
      t: AsanaTask,
      projectLocalId: string,
      currentProjectGid: string,
      sectionGid?: string | null,
      parentGid?: string,
      orderInColumn?: number
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
            asanaCustomFields: (t.custom_fields ?? null) as any,
            // Solo sobrescribimos `order` si el caller lo proporciona
            // (los re-imports preservan el orden de Asana). Si el user
            // luego reordena manualmente con drag&drop, ese order se
            // actualiza y prevalece hasta el siguiente import.
            ...(typeof orderInColumn === "number" ? { order: orderInColumn } : {})
          } as any
        });
      } else {
        // Race-safe: si entre el findUnique y este create alguien más
        // (otra subtarea importando en paralelo, retry del job, etc.)
        // ha creado la task con el mismo asanaId, capturamos P2002 y
        // hacemos update igual que la rama "exists" — así el import
        // no aborta a mitad y los siguientes adjuntos/comentarios
        // siguen colgando del task correcto.
        try {
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
              asanaCustomFields: (t.custom_fields ?? null) as any,
              order: orderInColumn ?? 0
            } as any
          });
        } catch (e: any) {
          if (e?.code !== "P2002") throw e;
          // Carrera: la task ya existe — buscamos y update.
          const existing = await prisma.task.findUnique({
            where: { asanaId: t.gid }
          });
          if (!existing) throw e; // No debería pasar pero por si acaso
          local = await prisma.task.update({
            where: { id: existing.id },
            data: {
              title: t.name,
              description: t.notes ?? "",
              status,
              priority,
              dueDate: due,
              completedAt: t.completed_at ? new Date(t.completed_at) : null,
              parentId: parentLocal ?? null,
              asanaPermalink: t.permalink_url ?? null,
              asanaCustomFields: (t.custom_fields ?? null) as any,
              ...(typeof orderInColumn === "number" ? { order: orderInColumn } : {})
            } as any
          });
        }
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
      // Comment.asanaId == story.gid. ensureUser fabrica un usuario
      // placeholder con email sintético si Asana no expone el email
      // del autor (caso típico de cuentas privadas) — así NUNCA se
      // pierde un comentario por falta de email.
      // Wrapper externo: si Asana falla la paginación de stories (red,
      // rate limit, 401), no perdemos las tareas, solo los comentarios
      // de esta. Lo registramos como warning para que el admin sepa
      // qué tareas revisar a mano.

      // Pre-fetch de TODOS los adjuntos del task con su parent.gid.
      // Asana adjunta los .txt/.pdf/etc de comentarios a la propia
      // story (parent.resource_type === "story"); /attachments?parent=
      // <story_gid> no siempre los devuelve, pero /tasks/<gid>/
      // attachments con opt_fields=parent.gid sí los lista TODOS, con
      // el parent correcto. Los agrupamos por story_gid para pasar al
      // parser solo los del comentario que está procesando.
      const attachmentsByStoryGid = new Map<string, string[]>();
      try {
        for await (const a of client.taskAttachments(t.gid)) {
          const pgid = (a as any).parent?.gid;
          const ptype = (a as any).parent?.resource_type;
          if (pgid && ptype === "story") {
            const list = attachmentsByStoryGid.get(pgid) ?? [];
            list.push(a.gid);
            attachmentsByStoryGid.set(pgid, list);
          }
        }
      } catch (e: any) {
        stats.warnings.push(
          `No se pudo listar parents de adjuntos de "${t.name}": ${String(e?.message ?? e).slice(0, 120)}`
        );
      }

      try {
      for await (const story of client.taskStories(t.gid)) {
        try {
        if (story.resource_subtype !== "comment_added") continue;
        // Algunos comentarios solo tienen imagen (html_text) sin texto.
        // Aceptamos si al menos uno de los dos viene con contenido.
        if (!story.text && !story.html_text) continue;
        // ANTES: if (!story.created_by?.gid) continue; → descartaba
        // silenciosamente comentarios de autores cuyo gid Asana ya no
        // devuelve (cuentas dadas de baja, exempleados, autores
        // anonimizados). Para Autosmotos esto perdía toda la
        // conversación con Hermary/Alejandro. Ahora fabricamos un gid
        // sintético a partir del nombre si Asana no lo da, y dejamos
        // que ensureUser cree el usuario placeholder igual que
        // hacemos cuando falta el email.
        const authorGid =
          story.created_by?.gid ??
          (story.created_by?.name
            ? `name-${story.created_by.name.replace(/\s+/g, "_").toLowerCase()}`
            : `anon-story-${story.gid}`);
        const authorId = await ensureUser(
          authorGid,
          story.created_by?.name,
          story.created_by?.email
        );
        if (!authorId) {
          // ensureUser ya no debería devolver null nunca (siempre
          // crea placeholder), pero por defensa lo dejamos.
          stats.warnings.push(`Comentario sin autor resoluble: tarea ${t.name}`);
          continue;
        }
        // Idempotencia por asanaId del story. Estrategia: si el
        // comment YA existe Y tiene CUALQUIER referencia a Asana
        // (URL app.asana.com, asset_id, data-asana-gid, tag <a>…)
        // lo reprocesamos: puede contener attachments inline que
        // antes no detectábamos por un patrón nuevo. Skip rápido
        // solo si el comment ya existe y es puramente texto plano
        // sin referencias a Asana.
        const exists = await prisma.comment.findUnique({ where: { asanaId: story.gid } });
        const combined = (story.html_text ?? "") + (story.text ?? "");
        const looksAsanaReferenced =
          /app\.asana\.com|asset_id=\d+|data-asana-(?:gid|type)|<a\s/i.test(combined);
        if (exists && !looksAsanaReferenced) {
          stats.commentsSkipped++;
          continue;
        }

        // Conversión rich del comentario: detecta imágenes inline
        // (asset_id de Asana), las descarga y las inserta como nodos
        // `image` en el bodyJson. Así el comentario en el Hub se ve
        // visualmente igual que en Asana — imágenes embebidas, no
        // links opacos.
        const parsed = await parseAsanaCommentToTipTap({
          client,
          workspaceId: opts.workspaceId,
          taskLocalId: local.id,
          story: { gid: story.gid, text: story.text, html_text: story.html_text },
          // Adjuntos cuyo parent es ESTA story — el parser los baja a
          // R2 y los pega como "📎 nombre" al final del doc.
          extraAttachmentGids: attachmentsByStoryGid.get(story.gid) ?? []
        });
        stats.attachmentsImported += parsed.assetsImported;
        stats.attachmentsFailed += parsed.assetsFailed;

        if (exists) {
          // Refresh: además de actualizar body/bodyJson, RE-LINK al
          // targetId/workspaceId/authorId actuales por si una
          // importación previa los dejó apuntando a una tarea local
          // que ya no existe (re-creación, soft-delete + restore, etc).
          // Sin esto los comentarios quedan huérfanos y no aparecen en
          // el modal aunque el import diga "ya existía, refrescado".
          await prisma.comment.update({
            where: { id: exists.id },
            data: {
              body: story.text ?? "",
              bodyJson: parsed.doc as any,
              targetId: local.id,
              targetType: "TASK",
              workspaceId: opts.workspaceId,
              authorId
            }
          });
          if (exists.targetId !== local.id) {
            stats.warnings.push(
              `Comentario ${story.gid} re-enlazado: ${exists.targetId} → ${local.id} (tarea "${t.name}")`
            );
          }
          stats.commentsSkipped++; // ya existía, solo refrescado
        } else {
          // Race-safe: si entre el findUnique y este create hay
          // carrera (otro batch del mismo import importando en
          // paralelo, retry de un job, etc.), capturamos P2002 y
          // hacemos update igual que en la rama "exists".
          try {
            await prisma.comment.create({
              data: {
                workspaceId: opts.workspaceId,
                authorId,
                targetType: "TASK",
                targetId: local.id,
                // `body` para la lectura legacy (búsqueda LIKE),
                // bodyJson para la UI rich con imágenes inline.
                body: story.text ?? "",
                bodyJson: parsed.doc as any,
                asanaId: story.gid,
                createdAt: new Date(story.created_at)
              }
            });
            stats.comments++;
          } catch (e: any) {
            if (e?.code === "P2002") {
              // Carrera: ya existe — refresh + relink.
              await prisma.comment.updateMany({
                where: { asanaId: story.gid },
                data: {
                  body: story.text ?? "",
                  bodyJson: parsed.doc as any,
                  targetId: local.id,
                  targetType: "TASK",
                  workspaceId: opts.workspaceId,
                  authorId
                }
              });
              stats.commentsSkipped++;
            } else {
              // Un comentario problemático no debe abortar el resto.
              stats.warnings.push(
                `Comentario ${story.gid} de "${t.name}" falló: ${String(e?.message ?? e).slice(0, 200)}`
              );
            }
          }
        }
        } catch (e: any) {
          // Per-story catch (envolvía toda la iteración antes).
          // Mantiene que un comentario problemático no aborte el bucle.
          stats.warnings.push(
            `Comentario ${story?.gid ?? "?"} de "${t.name}" falló: ${String(e?.message ?? e).slice(0, 200)}`
          );
        }
      }
      } catch (e: any) {
        stats.warnings.push(
          `No se pudieron listar comentarios de "${t.name}": ${String(e?.message ?? e).slice(0, 200)}`
        );
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

    const totalProjects = projectByGid.size;
    let projectIdx = 0;
    for (const [projectGid, info] of projectByGid) {
      projectIdx++;
      const localProj = await prisma.project.findUnique({
        where: { id: info.localId },
        select: { name: true }
      });
      const projName = localProj?.name ?? projectGid;
      await heartbeat(jobId, `Importando tareas — proyecto ${projectIdx}/${totalProjects}: ${projName}`);
      // Asana devuelve las tareas en el orden que tienen en el
      // proyecto (top-to-bottom como las ve el user). Asignamos
      // `order` incremental por columna para preservar ese orden,
      // si no todas quedan con order=0 y el tie-break por createdAt
      // las invierte. El order es POR COLUMNA: cada sección tiene su
      // propia secuencia.
      const orderPerColumn = new Map<string, number>();
      let tasksThisProject = 0;
      for await (const t of client.projectTasks(projectGid)) {
        // CRÍTICO: cada tarea se importa en su propio try/catch. Si
        // upsertTask falla por una tarea concreta (atributo raro,
        // race condition, conflict en unique), antes mataba el import
        // entero y perdías las 800 tareas siguientes. Ahora logueamos
        // warning y seguimos. La tarea fallida se podrá re-importar
        // sin duplicar por idempotencia con asanaId.
        try {
          const membership = t.memberships?.find((m) => m.project.gid === projectGid);
          const sectionGid = membership?.section?.gid ?? null;
          const sectionName = membership?.section?.name ?? null;

          // Si la sección de la task NO está en el map del proyecto
          // (porque se añadió en Asana DESPUÉS de la lectura inicial
          // de secciones, o porque el API devolvió la lista incompleta
          // por alguna razón), la añadimos AHORA al proyecto. Sin esto,
          // tasks con sección desconocida caían al genérico TODO —
          // amontonadas en "primera columna" en vez de su sección real.
          if (sectionGid && sectionName && !info.sections.has(sectionGid)) {
            const existingIds = new Set(Array.from(info.sections.values()).map((s) => s.columnId));
            let colId = slugifyColumnId(sectionName);
            if (!colId) colId = `COL_EXTRA_${existingIds.size + 1}`;
            let base = colId;
            let n = 2;
            while (existingIds.has(colId)) {
              colId = `${base}_${n}`;
              n++;
            }
            info.sections.set(sectionGid, { name: sectionName, columnId: colId });

            // Persistir la nueva columna en el proyecto. Leemos las
            // actuales y añadimos al final.
            const proj = await prisma.project.findUnique({
              where: { id: info.localId },
              select: { kanbanColumns: true }
            });
            const currentCols = Array.isArray(proj?.kanbanColumns) ? (proj!.kanbanColumns as any[]) : [];
            const isDone = /(hecho|done|complete|publicad|finalizad)/i.test(sectionName);
            const newCol: any = {
              id: colId,
              label: sectionName,
              color: COLUMN_PALETTE[currentCols.length % COLUMN_PALETTE.length],
              order: currentCols.length
            };
            if (isDone) newCol.isDone = true;
            await prisma.project.update({
              where: { id: info.localId },
              data: { kanbanColumns: [...currentCols, newCol] as any }
            });
          }

          const sectionInfo = sectionGid ? info.sections.get(sectionGid) : null;
          const colKey = sectionInfo?.columnId ?? "__nocol__";
          const nextOrder = orderPerColumn.get(colKey) ?? 0;
          orderPerColumn.set(colKey, nextOrder + 1);
          await upsertTask(t, info.localId, projectGid, sectionGid, undefined, nextOrder);
          stats.tasks++;

          // Subtareas — heredan el proyecto principal del padre y su
          // sección (las subtareas en Asana no tienen sección propia).
          let subOrder = 0;
          for await (const sub of client.taskSubtasks(t.gid)) {
            try {
              await upsertTask(sub, info.localId, projectGid, sectionGid, t.gid, subOrder);
              subOrder++;
              stats.subtasks++;
            } catch (e: any) {
              stats.warnings.push(`subtarea ${sub.gid} de ${t.gid}: ${String(e?.message ?? e).slice(0, 200)}`);
            }
          }
        } catch (e: any) {
          stats.warnings.push(`tarea ${t.gid} "${t.name?.slice(0, 60)}": ${String(e?.message ?? e).slice(0, 200)}`);
        }
        tasksThisProject++;
        // Persistimos stats cada 25 tareas — así el UI ve progreso
        // real y, si el proceso muere, sabemos hasta dónde llegó.
        if (tasksThisProject % 25 === 0) {
          await persistStats(
            jobId,
            stats,
            `Importando tareas — proyecto ${projectIdx}/${totalProjects}: ${projName} (${tasksThisProject} en este proyecto)`
          );
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

async function persistStats(jobId: string, stats: Stats, stage?: string) {
  // Cap warnings a las últimas 200 líneas — sin esto, un proyecto
  // problemático puede generar miles de warnings y el JSON resultante
  // peta el límite de columna BD o el bundle del UI.
  const capped: Stats = {
    ...stats,
    warnings: stats.warnings.length > 200 ? stats.warnings.slice(-200) : stats.warnings
  };
  await prisma.asanaImport.update({
    where: { id: jobId },
    data: {
      stats: capped as any,
      lastHeartbeatAt: new Date(),
      ...(stage ? { currentStage: stage } : {})
    }
  });
}

/**
 * Latido sin tocar stats — para etapas largas donde el contador no
 * cambia (esperando una llamada Asana lenta, descargando un attachment
 * grande). Sin esto el UI vería "atascado" cuando en realidad solo
 * está aguantando una red lenta.
 */
async function heartbeat(jobId: string, stage?: string) {
  await prisma.asanaImport.update({
    where: { id: jobId },
    data: {
      lastHeartbeatAt: new Date(),
      ...(stage ? { currentStage: stage } : {})
    }
  }).catch(() => {});
}

// ============================================================
// RE-IMPORT DE UNA COLUMNA CONCRETA
// ============================================================
//
// Re-importa todas las tasks de UNA sección de Asana, mapeándolas
// dentro de un proyecto YA importado en el Hub. Útil para limpiar
// columnas arrastradas con bugs de imports antiguos sin volver a
// pasar por TODO el proyecto.
//
// Idempotente (usa nuestros fixes P2002): tasks/comments/files que ya
// existen se actualizan + re-enlazan; los que no, se crean.

export type ReimportSectionResult = {
  ok: boolean;
  projectName: string;
  sectionName: string;
  tasksProcessed: number;
  tasksCreated: number;
  tasksUpdated: number;
  commentsImported: number;
  commentsUpdated: number;
  attachmentsImported: number;
  attachmentsSkipped: number;
  warnings: string[];
};

/**
 * Helper standalone para crear/recuperar un user a partir de un gid
 * Asana — versión simplificada de la usada en startAsanaImport.
 */
async function ensureUserStandalone(opts: {
  workspaceId: string;
  cache: Map<string, string>;
  gid: string;
  name?: string | null;
  email?: string | null;
}): Promise<string | null> {
  const cached = opts.cache.get(opts.gid);
  if (cached) return cached;
  const effectiveEmail = opts.email ?? `asana-${opts.gid}@imported.local`;
  const effectiveName =
    opts.name ?? (opts.email ?? `Usuario Asana ${opts.gid.slice(-6)}`);
  const existing = await prisma.user.findUnique({ where: { email: effectiveEmail } });
  if (existing) {
    opts.cache.set(opts.gid, existing.id);
    return existing.id;
  }
  const created = await prisma.user.create({
    data: {
      email: effectiveEmail,
      name: effectiveName,
      memberships: { create: { workspaceId: opts.workspaceId, role: "GUEST" } }
    }
  });
  opts.cache.set(opts.gid, created.id);
  return created.id;
}

export async function reimportAsanaSection(opts: {
  workspaceId: string;
  /** Proyecto LOCAL del Hub (no el gid de Asana). */
  projectId: string;
  /** Gid de la sección de Asana a importar. */
  sectionGid: string;
  /** Token Asana ya leído. */
  token: string;
  /** Columna del Hub a la que mapear las tasks. Si no se pasa,
   *  intentamos derivarla del nombre de la sección con slugify. */
  targetColumnId?: string;
}): Promise<ReimportSectionResult> {
  const project = await prisma.project.findFirst({
    where: { id: opts.projectId, workspaceId: opts.workspaceId }
  });
  if (!project) throw new Error(`Project ${opts.projectId} no existe en el workspace`);
  if (!(project as any).asanaId) {
    throw new Error("Este proyecto no fue importado de Asana — no tiene asanaId");
  }

  const client = new AsanaClient(opts.token);

  // Determinar nombre de la sección y target column
  const sectionList: Array<{ gid: string; name: string }> = [];
  for await (const s of client.projectSections((project as any).asanaId)) {
    sectionList.push({ gid: s.gid, name: s.name });
  }
  const section = sectionList.find((s) => s.gid === opts.sectionGid);
  if (!section) {
    throw new Error(
      `La sección ${opts.sectionGid} no existe en el proyecto Asana ${(project as any).asanaId}. Ya no está, o se renombró.`
    );
  }
  const kanbanColumns =
    Array.isArray((project as any).kanbanColumns) ? (project as any).kanbanColumns : [];
  let columnId = opts.targetColumnId;
  if (!columnId) {
    const slug = slugifyColumnId(section.name);
    const matched = kanbanColumns.find(
      (c: any) =>
        c.id === slug ||
        c.label?.toLowerCase().trim() === section.name.toLowerCase().trim()
    );
    columnId = matched?.id ?? slug;
  }

  const result: ReimportSectionResult = {
    ok: true,
    projectName: project.name,
    sectionName: section.name,
    tasksProcessed: 0,
    tasksCreated: 0,
    tasksUpdated: 0,
    commentsImported: 0,
    commentsUpdated: 0,
    attachmentsImported: 0,
    attachmentsSkipped: 0,
    warnings: []
  };

  const userCache = new Map<string, string>();

  for await (const t of client.sectionTasks(opts.sectionGid)) {
    result.tasksProcessed++;
    try {
      const due = t.due_at || t.due_on ? new Date(t.due_at ?? t.due_on!) : null;
      const priority = detectPriorityFromCustomFields(t.custom_fields);
      const status = columnId ?? "TODO";

      let local = await prisma.task.findUnique({ where: { asanaId: t.gid } });
      if (local) {
        await prisma.task.update({
          where: { id: local.id },
          data: {
            title: t.name,
            description: t.notes ?? "",
            status: status as any,
            priority,
            dueDate: due,
            completedAt: t.completed_at ? new Date(t.completed_at) : null,
            projectId: opts.projectId,
            asanaPermalink: t.permalink_url ?? null,
            asanaCustomFields: (t.custom_fields ?? null) as any
          } as any
        });
        result.tasksUpdated++;
      } else {
        try {
          local = await prisma.task.create({
            data: {
              workspaceId: opts.workspaceId,
              projectId: opts.projectId,
              title: t.name,
              description: t.notes ?? "",
              status: status as any,
              priority,
              dueDate: due,
              completedAt: t.completed_at ? new Date(t.completed_at) : null,
              asanaId: t.gid,
              asanaPermalink: t.permalink_url ?? null,
              asanaCustomFields: (t.custom_fields ?? null) as any
            } as any
          });
          result.tasksCreated++;
        } catch (e: any) {
          if (e?.code !== "P2002") throw e;
          // Race: alguien lo creó entre find y create. Re-buscar+update.
          const ex = await prisma.task.findUnique({ where: { asanaId: t.gid } });
          if (!ex) throw e;
          await prisma.task.update({
            where: { id: ex.id },
            data: {
              title: t.name,
              description: t.notes ?? "",
              status: status as any,
              priority,
              dueDate: due,
              projectId: opts.projectId,
              completedAt: t.completed_at ? new Date(t.completed_at) : null,
              asanaPermalink: t.permalink_url ?? null,
              asanaCustomFields: (t.custom_fields ?? null) as any
            } as any
          });
          local = ex;
          result.tasksUpdated++;
        }
      }

      // Comentarios
      try {
        for await (const story of client.taskStories(t.gid)) {
          if (story.resource_subtype !== "comment_added") continue;
          if (!story.text && !story.html_text) continue;

          const authorGid =
            story.created_by?.gid ?? `synthetic-${(story.created_by?.name ?? "anon").replace(/\s/g, "_")}`;
          const authorId = await ensureUserStandalone({
            workspaceId: opts.workspaceId,
            cache: userCache,
            gid: authorGid,
            name: story.created_by?.name,
            email: story.created_by?.email ?? null
          });
          if (!authorId) continue;

          const parsed = await parseAsanaCommentToTipTap({
            client,
            workspaceId: opts.workspaceId,
            taskLocalId: local.id,
            story: { gid: story.gid, text: story.text, html_text: story.html_text },
            extraAttachmentGids: []
          });

          const exists = await prisma.comment.findUnique({ where: { asanaId: story.gid } });
          if (exists) {
            await prisma.comment.update({
              where: { id: exists.id },
              data: {
                body: story.text ?? "",
                bodyJson: parsed.doc as any,
                targetId: local.id,
                targetType: "TASK",
                workspaceId: opts.workspaceId,
                authorId
              }
            });
            result.commentsUpdated++;
          } else {
            try {
              await prisma.comment.create({
                data: {
                  workspaceId: opts.workspaceId,
                  authorId,
                  targetType: "TASK",
                  targetId: local.id,
                  body: story.text ?? "",
                  bodyJson: parsed.doc as any,
                  asanaId: story.gid,
                  createdAt: new Date(story.created_at)
                }
              });
              result.commentsImported++;
            } catch (e: any) {
              if (e?.code === "P2002") {
                await prisma.comment.updateMany({
                  where: { asanaId: story.gid },
                  data: {
                    body: story.text ?? "",
                    bodyJson: parsed.doc as any,
                    targetId: local.id,
                    targetType: "TASK",
                    workspaceId: opts.workspaceId,
                    authorId
                  }
                });
                result.commentsUpdated++;
              } else throw e;
            }
          }
        }
      } catch (e: any) {
        result.warnings.push(
          `Comentarios de "${t.name}" fallaron: ${String(e?.message ?? e).slice(0, 200)}`
        );
      }

      // Adjuntos (la función ya tiene P2002-safe + relink)
      try {
        const r = await importAttachmentsForTask({
          client,
          workspaceId: opts.workspaceId,
          taskLocalId: local.id,
          taskAsanaGid: t.gid
        });
        result.attachmentsImported += r.imported + r.externalLinked;
        result.attachmentsSkipped += r.skipped;
        if (r.failed > 0) {
          result.warnings.push(
            `Adjuntos en "${t.name}": ${r.failed} fallidos (${r.errors.slice(0, 2).join(", ")})`
          );
        }
      } catch (e: any) {
        result.warnings.push(
          `Adjuntos de "${t.name}" fallaron: ${String(e?.message ?? e).slice(0, 200)}`
        );
      }
    } catch (e: any) {
      result.warnings.push(
        `Task "${t.name}" (${t.gid}) falló: ${String(e?.message ?? e).slice(0, 200)}`
      );
    }
  }

  return result;
}
