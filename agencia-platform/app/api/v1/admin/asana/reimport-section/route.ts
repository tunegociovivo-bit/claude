/**
 * POST /api/v1/admin/asana/reimport-section
 *
 * Re-importa una o varias columnas/secciones concretas de un proyecto YA importado.
 *
 * Body:
 *   - projectId: id local del proyecto en el Hub
 *   - sectionGid: gid de la sección en Asana (compatibilidad)
 *   - sectionGids: array de gids de secciones en Asana
 *   - targetColumnId (opcional): id de columna del Kanban donde colocar
 *     las tasks. Si no se pasa, se intenta derivar del nombre de sección.
 *
 * Devuelve estadísticas inline (no es background — son pocas tasks).
 *
 * GET sin params: lista las secciones del proyecto (vía Asana en vivo),
 *   para que el UI sepa qué ofrecer.
 *   ?projectId=... requerido.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { readAsanaToken } from "@/lib/asana/token";
import { AsanaClient } from "@/lib/asana/client";
import { reimportAsanaSection } from "@/lib/asana/importer";

export const dynamic = "force-dynamic";

async function getToken(api: any): Promise<string> {
  if (!api.userId) throw new ApiError(400, "no_user", "Sesión requerida");
  const conn = await prisma.asanaConnection.findFirst({ where: { userId: api.userId }, orderBy: { createdAt: "desc" } });
  const token = conn ? readAsanaToken(conn) : null;
  if (!token) throw new ApiError(400, "no_token", "Conecta Asana primero en /admin/asana");
  return token;
}

export const GET = withApi({ scope: "admin" }, async (req, { api }) => {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) throw new ApiError(400, "missing", "?projectId= requerido");

  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId: api.workspaceId }
  });
  if (!project) throw new ApiError(404, "not_found", "Proyecto no encontrado");
  if (!(project as any).asanaId) {
    throw new ApiError(400, "no_asana", "Este proyecto no viene de Asana");
  }

  const token = await getToken(api);
  const client = new AsanaClient(token);
  const sections: Array<{ gid: string; name: string }> = [];
  for await (const s of client.projectSections((project as any).asanaId)) {
    sections.push({ gid: s.gid, name: s.name });
  }
  return NextResponse.json({
    projectName: project.name,
    asanaId: (project as any).asanaId,
    sections,
    kanbanColumns: (project as any).kanbanColumns ?? []
  });
});

export const POST = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const projectId = String(body?.projectId ?? "");
  const sectionGids = Array.isArray(body?.sectionGids)
    ? body.sectionGids.map((v: unknown) => String(v)).filter(Boolean)
    : String(body?.sectionGid ?? "")
      ? [String(body.sectionGid)]
      : [];
  const targetColumnId = body?.targetColumnId ? String(body.targetColumnId) : undefined;
  if (!projectId || sectionGids.length === 0) {
    throw new ApiError(400, "missing", "projectId y sectionGid/sectionGids requeridos");
  }
  if (sectionGids.length > 50) {
    throw new ApiError(400, "too_many", "Selecciona como máximo 50 columnas por tanda");
  }

  const token = await getToken(api);

  const results = [];
  for (const sectionGid of sectionGids) {
    const result = await reimportAsanaSection({
      workspaceId: api.workspaceId,
      projectId,
      sectionGid,
      // targetColumnId solo tiene sentido cuando se reimporta una única columna.
      targetColumnId: sectionGids.length === 1 ? targetColumnId : undefined,
      token,
      // Por defecto NO resucita tareas borradas (respeta tus eliminaciones).
      restoreDeleted: body?.restoreDeleted === true
    });
    results.push(result);
  }

  if (results.length === 1) return NextResponse.json(results[0]);

  return NextResponse.json({
    ok: true,
    projectName: results[0]?.projectName ?? "",
    sectionName: `${results.length} columnas`,
    sections: results,
    tasksProcessed: results.reduce((sum, r) => sum + r.tasksProcessed, 0),
    tasksCreated: results.reduce((sum, r) => sum + r.tasksCreated, 0),
    tasksUpdated: results.reduce((sum, r) => sum + r.tasksUpdated, 0),
    commentsImported: results.reduce((sum, r) => sum + r.commentsImported, 0),
    commentsUpdated: results.reduce((sum, r) => sum + r.commentsUpdated, 0),
    attachmentsImported: results.reduce((sum, r) => sum + r.attachmentsImported, 0),
    attachmentsSkipped: results.reduce((sum, r) => sum + r.attachmentsSkipped, 0),
    warnings: results.flatMap((r) => r.warnings.map((w) => `${r.sectionName}: ${w}`))
  });
});
