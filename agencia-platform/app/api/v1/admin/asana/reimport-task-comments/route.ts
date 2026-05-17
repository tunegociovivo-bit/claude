/**
 * POST /api/v1/admin/asana/reimport-task-comments?taskGid=NNN
 *
 * Re-importa SOLO los comentarios (stories) de una tarea concreta de
 * Asana. Útil cuando el flujo completo de import deja una tarea sin
 * comentarios y no sabemos por qué — este endpoint los procesa uno a
 * uno y devuelve un informe detallado:
 *   {
 *     storiesFound: 35,
 *     created: 30,
 *     updated: 3,
 *     skipped: 2,
 *     perStory: [
 *       {gid, action: "created"|"updated"|"skipped"|"error", reason},
 *       ...
 *     ]
 *   }
 *
 * NO crea task ni adjuntos — solo comentarios. La tarea ya tiene
 * que existir en BD por una importación previa (la buscamos por
 * asanaId).
 *
 * Solo ADMIN del workspace.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { AsanaClient } from "@/lib/asana/client";
import { readAsanaToken } from "@/lib/asana/token";
import { parseAsanaCommentToTipTap } from "@/lib/asana/comment-parser";
import { importAttachmentsForTask } from "@/lib/asana/attachments";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");

  const url = new URL(req.url);
  const taskGid = url.searchParams.get("taskGid");
  const localTaskId = url.searchParams.get("localTaskId");

  if (!taskGid && !localTaskId) {
    throw new ApiError(400, "missing", "Pasa taskGid o localTaskId");
  }

  // Localizamos la tarea local
  const localTask = await prisma.task.findFirst({
    where: {
      workspaceId: api.workspaceId,
      ...(taskGid ? { asanaId: taskGid } : { id: localTaskId! })
    }
  });
  if (!localTask) {
    throw new ApiError(404, "no_local_task", "La tarea no existe localmente. Re-importa el proyecto primero.");
  }
  const asanaGid = localTask.asanaId;
  if (!asanaGid) {
    throw new ApiError(400, "no_asana_id", "Esta tarea local no tiene asanaId.");
  }

  // Conexión y token Asana del user
  const conn = await prisma.asanaConnection.findFirst({ where: { userId: api.userId } });
  if (!conn) throw new ApiError(404, "no_token", "Conecta Asana primero en /admin/asana");
  const token = readAsanaToken(conn);
  if (!token) throw new ApiError(500, "decrypt_failed", "Token corrupto");

  const client = new AsanaClient(token);

  // Cache local de users para no duplicar lookups
  const userByGid = new Map<string, string>();
  async function ensureUserLocal(
    gid: string,
    name?: string | null,
    email?: string | null
  ): Promise<string | null> {
    const cached = userByGid.get(gid);
    if (cached) return cached;
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
        memberships: { create: { workspaceId: api.workspaceId, role: "GUEST" } }
      }
    });
    userByGid.set(gid, created.id);
    return created.id;
  }

  type PerStory = {
    gid: string;
    action: "created" | "updated" | "skipped" | "error";
    reason?: string;
    hasText: boolean;
    hasHtml: boolean;
    htmlLength: number;
    authorName: string | null;
    authorGid: string | null;
    hadAuthorEmail: boolean;
    extraAttachments?: number;
  };
  const perStory: PerStory[] = [];
  let storiesFound = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  // CRÍTICO: pre-fetch de TODOS los adjuntos del task pidiendo
  // parent.gid + parent.resource_type. Asana adjunta los .txt/.pdf
  // arrastrados al cuerpo del comentario a la propia story
  // (parent.resource_type === "story"). Sin este pre-fetch, el botón
  // "Re-importar de Asana" perdía esos adjuntos aunque el importer
  // completo SÍ los recuperase. Diagnóstico devuelto en el JSON
  // como extraAttachments por story para que el admin vea cuántos
  // se han enganchado a cada comentario.
  const attachmentsByStoryGid = new Map<string, string[]>();
  const attachmentDebug: { all: number; byStory: number; byTask: number; orphan: number } = {
    all: 0, byStory: 0, byTask: 0, orphan: 0
  };
  try {
    for await (const a of client.taskAttachments(asanaGid)) {
      attachmentDebug.all++;
      const pgid = (a as any).parent?.gid;
      const ptype = (a as any).parent?.resource_type;
      if (pgid && ptype === "story") {
        attachmentDebug.byStory++;
        const list = attachmentsByStoryGid.get(pgid) ?? [];
        list.push(a.gid);
        attachmentsByStoryGid.set(pgid, list);
      } else if (pgid && ptype === "task") {
        attachmentDebug.byTask++;
      } else {
        attachmentDebug.orphan++;
      }
    }
  } catch {
    // Si la lista falla, seguimos sin extras — los inline del
    // html_text se procesan igual.
  }

  try {
    for await (const story of client.taskStories(asanaGid)) {
      const base: PerStory = {
        gid: story.gid,
        action: "skipped",
        hasText: !!story.text,
        hasHtml: !!story.html_text,
        htmlLength: (story.html_text ?? "").length,
        authorName: story.created_by?.name ?? null,
        authorGid: story.created_by?.gid ?? null,
        hadAuthorEmail: !!story.created_by?.email
      };
      try {
        if (story.resource_subtype !== "comment_added") {
          base.reason = `not_a_comment (${story.resource_subtype})`;
          perStory.push(base);
          skipped++;
          continue;
        }
        storiesFound++;

        if (!story.text && !story.html_text) {
          base.reason = "empty";
          perStory.push(base);
          skipped++;
          continue;
        }

        const authorGid =
          story.created_by?.gid ??
          (story.created_by?.name
            ? `name-${story.created_by.name.replace(/\s+/g, "_").toLowerCase()}`
            : `anon-story-${story.gid}`);
        const authorId = await ensureUserLocal(
          authorGid,
          story.created_by?.name,
          story.created_by?.email
        );
        if (!authorId) {
          base.reason = "author_resolve_failed";
          base.action = "error";
          perStory.push(base);
          errors++;
          continue;
        }

        const storyExtras = attachmentsByStoryGid.get(story.gid) ?? [];
        base.extraAttachments = storyExtras.length;
        const parsed = await parseAsanaCommentToTipTap({
          client,
          workspaceId: api.workspaceId,
          taskLocalId: localTask.id,
          story: { gid: story.gid, text: story.text, html_text: story.html_text },
          extraAttachmentGids: storyExtras
        });

        const exists = await prisma.comment.findUnique({ where: { asanaId: story.gid } });
        if (exists) {
          // Si el comentario existe pero apunta a OTRO targetId (porque
          // una importación previa lo creó cuando la tarea local tenía
          // un id distinto, o porque la tarea fue eliminada y re-creada),
          // lo re-enlazamos al targetId actual. También sincronizamos
          // workspaceId y targetType por defensa. Sin esto, los
          // comentarios "huérfanos" no aparecen en el modal aunque el
          // re-import diga "actualizado".
          await prisma.comment.update({
            where: { id: exists.id },
            data: {
              body: story.text ?? "",
              bodyJson: parsed.doc as any,
              targetId: localTask.id,
              targetType: "TASK",
              workspaceId: api.workspaceId,
              authorId
            }
          });
          if (exists.targetId !== localTask.id) {
            base.reason = `relinked from ${exists.targetId}`;
          }
          base.action = "updated";
          updated++;
        } else {
          await prisma.comment.create({
            data: {
              workspaceId: api.workspaceId,
              authorId,
              targetType: "TASK",
              targetId: localTask.id,
              body: story.text ?? "",
              bodyJson: parsed.doc as any,
              asanaId: story.gid,
              createdAt: new Date(story.created_at)
            }
          });
          base.action = "created";
          created++;
        }
        perStory.push(base);
      } catch (e: any) {
        base.action = "error";
        base.reason = String(e?.message ?? e).slice(0, 300);
        perStory.push(base);
        errors++;
      }
    }
  } catch (e: any) {
    return NextResponse.json(
      {
        error: { code: "stories_pagination_failed", message: String(e?.message ?? e) },
        partial: { storiesFound, created, updated, skipped, errors, perStory }
      },
      { status: 500 }
    );
  }

  // Importar TODOS los attachments del task (con sus parent.gid).
  // Asana NO expone comment→attachment vía API (lo confirmamos en el
  // debug-attachments: parent.resource_type es siempre "task"). Los
  // ficheros sueltos (xps, txt, pdf que el user "ve dentro de un
  // comentario" en Asana UI) viven a nivel de task en la API. Los
  // importamos como File con targetType="TASK" → aparecen en el
  // AttachmentList del modal de tarea (sección "Adjuntos") debajo
  // de los comentarios. NO van INSIDE de un comentario concreto
  // (esa info Asana no la da), pero al menos están visibles.
  let attachmentsResult: any = null;
  try {
    attachmentsResult = await importAttachmentsForTask({
      client,
      workspaceId: api.workspaceId,
      taskLocalId: localTask.id,
      taskAsanaGid: asanaGid
    });
  } catch (e: any) {
    attachmentsResult = { error: String(e?.message ?? e).slice(0, 300) };
  }

  return NextResponse.json({
    ok: true,
    taskAsanaGid: asanaGid,
    taskLocalId: localTask.id,
    taskTitle: localTask.title,
    storiesFound,
    created,
    updated,
    skipped,
    errors,
    perStory,
    attachmentDebug,
    taskAttachments: attachmentsResult
  });
});
