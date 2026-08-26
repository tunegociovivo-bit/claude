/**
 * GET /api/v1/admin/subvenciones/match?clientId=...
 * Cruza el cliente con las convocatorias abiertas y devuelve las que encajan.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { matchForClient } from "@/lib/subvenciones/match";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId")?.trim();
  const force = url.searchParams.get("refresh") === "1";
  if (!clientId) throw new ApiError(400, "no_client", "Falta clientId");
  try {
    const matches = await matchForClient(api.workspaceId, clientId, { force });
    // Adjunta el estado de gestión guardado por convocatoria.
    const estados = await prisma.subvencionEstado.findMany({
      where: { workspaceId: api.workspaceId, clientId, convocatoriaId: { in: matches.map((m) => m.id) } },
      select: { convocatoriaId: true, estado: true }
    });
    const titles = matches.map((m) => `Subvención · ${m.titulo}`.slice(0, 240));
    const tasks = titles.length ? await prisma.task.findMany({ where: { workspaceId: api.workspaceId, deletedAt: null, title: { in: titles } }, select: { id: true, projectId: true, title: true } }) : [];
    const byId = new Map(estados.map((e) => [e.convocatoriaId, e.estado]));
    const taskByTitle = new Map(tasks.map((task) => [task.title, task]));
    const withEstado = matches.map((m) => {
      const task = taskByTitle.get(`Subvención · ${m.titulo}`.slice(0, 240));
      return { ...m, estado: byId.get(m.id) ?? null, taskId: task?.id ?? null, taskProjectId: task?.projectId ?? null };
    });
    return NextResponse.json({ ok: true, matches: withEstado });
  } catch (e: any) {
    throw new ApiError(400, "match_error", e?.message ?? "No se pudo cruzar.");
  }
});
