/**
 * GET /api/v1/admin/asana/debug-attachments?taskGid=NNN
 *
 * Diagnóstico exhaustivo de cómo Asana expone los adjuntos para una
 * tarea concreta. Llamamos a TODAS las combinaciones posibles para
 * ver cuál devuelve los .txt/.pdf/.xps que el user dice que no
 * aparecen y por qué.
 *
 * Devuelve un JSON con:
 *   - taskAttachments: /tasks/{gid}/attachments con parent.gid y parent.resource_type
 *   - attachmentsViaParentTask: /attachments?parent=<task_gid>
 *   - stories: lista de stories de la tarea (solo gid + resource_subtype + tipo)
 *   - perStoryAttachments: por cada story, /attachments?parent=<story_gid>
 *     con flag de éxito + payload o error.
 *   - attachmentDetails: para los 5 primeros attachments encontrados,
 *     el detalle completo (incluye download_url + parent confirmado).
 *
 * Con este JSON podemos decidir: ¿Asana expone los adjuntos del
 * comentario en /tasks/{gid}/attachments con parent.resource_type=
 * "story"? ¿En /attachments?parent=story_gid? ¿En ningún sitio?
 *
 * Solo admin.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { AsanaClient } from "@/lib/asana/client";
import { readAsanaToken } from "@/lib/asana/token";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");

  const url = new URL(req.url);
  const taskGid = url.searchParams.get("taskGid");
  const localTaskId = url.searchParams.get("localTaskId");
  let asanaGid = taskGid;
  if (!asanaGid && localTaskId) {
    const t = await prisma.task.findFirst({
      where: { id: localTaskId, workspaceId: api.workspaceId },
      select: { asanaId: true }
    });
    asanaGid = t?.asanaId ?? null;
  }
  if (!asanaGid) throw new ApiError(400, "missing", "Pasa taskGid o localTaskId");

  const conn = await prisma.asanaConnection.findFirst({ where: { userId: api.userId }, orderBy: { createdAt: "desc" } });
  if (!conn) throw new ApiError(404, "no_token", "Conecta Asana primero");
  const token = readAsanaToken(conn);
  if (!token) throw new ApiError(500, "decrypt_failed", "Token corrupto");

  const client = new AsanaClient(token);
  const raw = async (path: string, params?: Record<string, string>): Promise<any> => {
    // Llamada directa a la API de Asana sin pasar por nuestros helpers
    // — así vemos el payload completo sin recortes.
    const u = new URL("https://app.asana.com/api/1.0" + path);
    if (params) for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const r = await fetch(u, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store"
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { __status: r.status, __error: body.slice(0, 500) };
    }
    return r.json();
  };

  // 1) /tasks/{gid}/attachments con parent + resource_subtype
  const taskAttachmentsResp = await raw(`/tasks/${asanaGid}/attachments`, {
    opt_fields: "gid,name,resource_subtype,host,size,parent.gid,parent.resource_type,parent.name"
  });

  // 2) /attachments?parent=<task_gid>
  const viaParentTask = await raw(`/attachments`, {
    parent: asanaGid,
    opt_fields: "gid,name,resource_subtype,host,size,parent.gid,parent.resource_type"
  });

  // 3) Listar stories y para cada story_gid intentar /attachments?parent=<story_gid>
  const storiesResp = await raw(`/tasks/${asanaGid}/stories`, {
    opt_fields: "gid,resource_subtype,created_at,created_by.name"
  });
  const stories = Array.isArray(storiesResp?.data) ? storiesResp.data : [];
  const commentStories = stories.filter(
    (s: any) => s?.resource_subtype === "comment_added"
  );

  const perStoryAttachments: Array<{
    storyGid: string;
    createdAt?: string;
    createdBy?: string;
    response: any;
  }> = [];
  for (const s of commentStories.slice(0, 30)) {
    const r = await raw(`/attachments`, {
      parent: s.gid,
      opt_fields: "gid,name,resource_subtype,host,size,parent.gid,parent.resource_type"
    });
    perStoryAttachments.push({
      storyGid: s.gid,
      createdAt: s.created_at,
      createdBy: s.created_by?.name ?? null,
      response: r
    });
  }

  // 4) Detalle de los primeros attachments encontrados (max 5)
  const detailGids: string[] = [];
  if (Array.isArray(taskAttachmentsResp?.data)) {
    for (const a of taskAttachmentsResp.data.slice(0, 5)) {
      if (a?.gid) detailGids.push(a.gid);
    }
  }
  // Si la lista normal está vacía, probamos con los gids encontrados
  // por story.
  if (detailGids.length === 0) {
    for (const ps of perStoryAttachments) {
      const items = Array.isArray(ps.response?.data) ? ps.response.data : [];
      for (const a of items.slice(0, 2)) {
        if (a?.gid && !detailGids.includes(a.gid)) detailGids.push(a.gid);
        if (detailGids.length >= 5) break;
      }
      if (detailGids.length >= 5) break;
    }
  }
  const attachmentDetails: any[] = [];
  for (const gid of detailGids) {
    attachmentDetails.push(
      await raw(`/attachments/${gid}`, {
        opt_fields:
          "gid,name,resource_subtype,host,size,download_url,permanent_url,view_url,parent.gid,parent.resource_type,parent.name"
      })
    );
  }

  return NextResponse.json({
    taskGid: asanaGid,
    taskAttachments: taskAttachmentsResp,
    attachmentsViaParentTask: viaParentTask,
    storiesCount: stories.length,
    commentStoriesCount: commentStories.length,
    perStoryAttachments,
    attachmentDetails
  });
});
