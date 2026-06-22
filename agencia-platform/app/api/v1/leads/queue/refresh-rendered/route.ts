/**
 * POST /api/v1/leads/queue/refresh-rendered
 * Body (opcional): { limit?: number }
 *
 * Re-renderiza el texto de los mensajes EN COLA (status "queued") para que
 * recojan correcciones del motor (p. ej. posición/competidor del ranking
 * consistentes con la imagen). El texto se "congela" al encolar, así que sin
 * esto la cola sigue con el texto viejo.
 *
 * Recupera el cuerpo de origen de dos sitios:
 *   - templateId → LeadTemplate.body (envíos por plantilla/ranking).
 *   - sin templateId → el paso actual de la secuencia activa del lead
 *     (LeadSequenceAssignment.currentStep → LeadSequenceStep.templateBody).
 * Si el lead tiene varias secuencias activas (ambiguo) o ninguna, se informa.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { renderTemplate } from "@/lib/leads/template-engine";
import { getCompetitorRanking } from "@/lib/leads/competitors";

const POS_RE = /\{\{\s*(posicion|competidor_top|competidores_por_delante)\s*\}\}/;

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

  // Cuerpos de origen para los mensajes de SECUENCIA (sin templateId): el paso
  // actual de la(s) secuencia(s) activa(s) de cada lead.
  const seqLeadIds = [...new Set(queued.filter((m) => !m.templateId).map((m) => m.leadId))];
  const seqBodyByLead = new Map<string, string | null>(); // null = ambiguo/ninguno
  if (seqLeadIds.length > 0) {
    const assignments = await prisma.leadSequenceAssignment.findMany({
      where: { leadId: { in: seqLeadIds }, status: "active", lead: { workspaceId: api.workspaceId } },
      include: { sequence: { include: { steps: { orderBy: { order: "asc" } } } } }
    });
    const byLead = new Map<string, typeof assignments>();
    for (const a of assignments) {
      const arr = byLead.get(a.leadId) ?? [];
      arr.push(a);
      byLead.set(a.leadId, arr);
    }
    for (const leadId of seqLeadIds) {
      const arr = byLead.get(leadId) ?? [];
      if (arr.length !== 1) { seqBodyByLead.set(leadId, null); continue; } // 0 o varias → ambiguo
      const a = arr[0];
      const step = a.sequence.steps[a.currentStep];
      seqBodyByLead.set(leadId, step?.templateBody ?? null);
    }
  }

  let refreshed = 0;
  let ambiguas = 0;
  let unchanged = 0;
  const templateCache = new Map<string, string | null>();
  const rankingCache = new Map<string, any>(); // leadId → snapshot (o null)

  for (const m of queued) {
    let sourceBody: string | null = null;
    if (m.templateId) {
      let tplBody = templateCache.get(m.templateId);
      if (tplBody === undefined) {
        const tpl = await prisma.leadTemplate.findFirst({ where: { id: m.templateId, workspaceId: api.workspaceId }, select: { body: true } });
        tplBody = tpl?.body ?? null;
        templateCache.set(m.templateId, tplBody);
      }
      sourceBody = tplBody;
    } else {
      sourceBody = seqBodyByLead.get(m.leadId) ?? null;
    }

    if (!sourceBody) { ambiguas++; continue; }
    try {
      // Si el mensaje lleva ranking (imagen) o el texto usa posición/competidor,
      // recalculamos el snapshot UNA vez y renderizamos el texto con él, para que
      // texto, imagen y preview cuadren.
      const needsRanking = m.kind === "ranking" || POS_RE.test(sourceBody);
      let snapshot: any;
      if (needsRanking) {
        snapshot = rankingCache.get(m.leadId);
        if (snapshot === undefined) {
          const lead = await prisma.lead.findFirst({
            where: { id: m.leadId, workspaceId: api.workspaceId },
            select: {
              id: true, placeId: true, name: true, category: true, types: true, province: true,
              formattedAddress: true, address: true, latitude: true, longitude: true, rating: true, reviewsCount: true
            }
          });
          snapshot = lead ? await getCompetitorRanking(api.workspaceId, lead as any, { store: false, harvest: false }) : null;
          rankingCache.set(m.leadId, snapshot);
        }
      }
      const rendered = await renderTemplate({
        workspaceId: api.workspaceId,
        body: sourceBody,
        leadId: m.leadId,
        ...(needsRanking ? { ranking: snapshot } : {})
      });
      if (m.kind === "text" && !rendered.trim()) { unchanged++; continue; }
      await prisma.leadMessage.update({
        where: { id: m.id },
        data: { renderedMessage: rendered, ...(needsRanking ? { rankingSnapshot: snapshot ?? undefined } : {}) }
      });
      refreshed++;
    } catch {
      unchanged++;
    }
  }

  return NextResponse.json({
    ok: true,
    total: queued.length,
    refreshed,
    sinFuente: ambiguas,
    sinCambios: unchanged
  });
});
