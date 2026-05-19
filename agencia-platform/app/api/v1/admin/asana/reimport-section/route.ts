/**
 * POST /api/v1/admin/asana/reimport-section
 *
 * Re-importa UNA columna/sección concreta de un proyecto YA importado.
 *
 * Body:
 *   - projectId: id local del proyecto en el Hub
 *   - sectionGid: gid de la sección en Asana
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
  const conn = await prisma.asanaConnection.findFirst({ where: { userId: api.userId } });
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
  const sectionGid = String(body?.sectionGid ?? "");
  const targetColumnId = body?.targetColumnId ? String(body.targetColumnId) : undefined;
  if (!projectId || !sectionGid) {
    throw new ApiError(400, "missing", "projectId y sectionGid requeridos");
  }

  const token = await getToken(api);

  const result = await reimportAsanaSection({
    workspaceId: api.workspaceId,
    projectId,
    sectionGid,
    targetColumnId,
    token
  });
  return NextResponse.json(result);
});
