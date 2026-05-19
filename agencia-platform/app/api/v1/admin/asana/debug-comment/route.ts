/**
 * GET /api/v1/admin/asana/debug-comment?taskGid=NNN
 *
 * Devuelve los stories crudos (con html_text y text) de una tarea
 * Asana. Solo para diagnóstico — sirve para ver exactamente cómo
 * Asana embebe las imágenes inline cuando el parser no las captura.
 *
 * Pasos: si veo "url en vez de imagen", abrir esta URL con el
 * taskGid de la tarea en cuestión y el output me dice qué patrón
 * usa Asana (asset_id, data-asana-gid, ...). Con eso ajustamos el
 * parser.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { AsanaClient } from "@/lib/asana/client";
import { readAsanaToken } from "@/lib/asana/token";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");

  const url = new URL(req.url);
  // Acepta `taskGid` (Asana GID) o `localTaskId` (id de Task en el Hub).
  const taskGid = url.searchParams.get("taskGid");
  const localTaskId = url.searchParams.get("localTaskId");

  const conn = await prisma.asanaConnection.findFirst({ where: { userId: api.userId }, orderBy: { createdAt: "desc" } });
  if (!conn) throw new ApiError(404, "no_token", "Conecta Asana primero en /admin/asana");
  const token = readAsanaToken(conn);
  if (!token) throw new ApiError(500, "decrypt_failed", "Token corrupto, reconecta");

  let asanaGid = taskGid;
  if (!asanaGid && localTaskId) {
    const t = await prisma.task.findFirst({
      where: { id: localTaskId, workspaceId: api.workspaceId },
      select: { asanaId: true, title: true }
    });
    if (!t?.asanaId) throw new ApiError(404, "no_asana_id", "Esta tarea local no tiene asanaId");
    asanaGid = t.asanaId;
  }
  if (!asanaGid) throw new ApiError(400, "missing", "Falta taskGid o localTaskId");

  const client = new AsanaClient(token);
  const stories: any[] = [];
  for await (const s of client.taskStories(asanaGid)) {
    if (s.resource_subtype !== "comment_added") continue;
    stories.push({
      gid: s.gid,
      created_at: s.created_at,
      created_by: s.created_by?.name,
      text: s.text,
      html_text: s.html_text,
      // Patrones que detectamos para diagnosticar.
      patterns: {
        asset_id: (s.text + " " + (s.html_text ?? "")).match(/asset_id=\d+/g) ?? [],
        data_asana_gid: (s.html_text ?? "").match(/data-asana-gid="\d+"/g) ?? [],
        data_asana_type: (s.html_text ?? "").match(/data-asana-type="[^"]+"/g) ?? [],
        a_tags: (s.html_text ?? "").match(/<a [^>]+>/g) ?? []
      }
    });
  }
  return NextResponse.json({ taskGid: asanaGid, stories });
});
