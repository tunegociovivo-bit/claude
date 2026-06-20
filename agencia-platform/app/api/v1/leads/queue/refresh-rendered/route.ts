/**
 * POST /api/v1/leads/queue/refresh-rendered
 * Body (opcional): { limit?: number }
 *
 * Re-renderiza el texto de los mensajes EN COLA (status "queued") que vienen de
 * una plantilla (templateId), para que recojan correcciones del motor (p. ej.
 * posición/competidor del ranking consistentes con la imagen). El texto se
 * "congela" al encolar, así que sin esto la cola sigue con el texto viejo.
 *
 * Los mensajes SIN templateId (p. ej. de secuencias) no se pueden re-renderizar
 * desde aquí (no se guarda su plantilla de origen); se informan aparte.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { renderTemplate } from "@/lib/leads/template-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const body = (await req.json().catch(() => ({}))) as { limit?: number };
  const limit = Math.min(Math.max(body.limit ?? 200, 1), 1000);

  const queued = await prisma.leadMessage.findMany({
    where: { workspaceId: api.workspaceId, status: "queued", kind: { in: ["text", "ranking"] } },
    select: { id: true, leadId: true, templateId: true, kind: true },
    orderBy: { scheduledAt: "asc" },
    take: limit
  });

  let refreshed = 0;
  let noTemplate = 0;
  let unchanged = 0;
  const templateCache = new Map<string, string | null>();

  for (const m of queued) {
    if (!m.templateId) { noTemplate++; continue; }
    let tplBody = templateCache.get(m.templateId);
    if (tplBody === undefined) {
      const tpl = await prisma.leadTemplate.findFirst({ where: { id: m.templateId, workspaceId: api.workspaceId }, select: { body: true } });
      tplBody = tpl?.body ?? null;
      templateCache.set(m.templateId, tplBody);
    }
    if (!tplBody) { noTemplate++; continue; }
    try {
      const rendered = await renderTemplate({ workspaceId: api.workspaceId, body: tplBody, leadId: m.leadId });
      // El ranking (kind="ranking") admite pie vacío (pie automático al enviar);
      // un texto vacío no se debe guardar.
      if (m.kind === "text" && !rendered.trim()) { unchanged++; continue; }
      await prisma.leadMessage.update({ where: { id: m.id }, data: { renderedMessage: rendered } });
      refreshed++;
    } catch {
      unchanged++;
    }
  }

  return NextResponse.json({
    ok: true,
    total: queued.length,
    refreshed,
    skippedSinPlantilla: noTemplate,
    sinCambios: unchanged
  });
});
