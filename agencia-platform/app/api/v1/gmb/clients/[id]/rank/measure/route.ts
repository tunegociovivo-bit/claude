/**
 * Rank Grid — trigger de medición.
 *  POST { keyword? } → ENCOLA jobs de medición (una por keyword; si no se indica, todas las
 *    rastreadas). Bloqueo HONESTO si no hay proveedor: responde 200 con blocked=true e instrucciones.
 *  GET → estado de los jobs recientes (progreso/errores). Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient } from "@/lib/gmb/server";
import { enqueueRankJob } from "@/lib/gmb/rank-job";
import { resolveRankProvider } from "@/lib/gmb/rank-adapter";

export const dynamic = "force-dynamic";

const schema = z.object({ keyword: z.string().max(120).optional() });

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Bloqueo honesto: sin proveedor (clave de Maps) no se encola ni se inventa nada.
  const provider = await resolveRankProvider(api.workspaceId);
  if (!provider) {
    return NextResponse.json({ ok: true, blocked: true, reason: "sin_proveedor", note: "El Rank Grid requiere una clave de Google Maps. Configúrala en Ajustes para medir posiciones reales. No se generan datos ficticios." });
  }

  const cfg = await prisma.gmbRankConfig.findFirst({ where: { workspaceId: api.workspaceId, clientId: client.id } });
  const centerLat = cfg?.centerLat ?? client.latitude ?? null;
  const centerLng = cfg?.centerLng ?? client.longitude ?? null;
  if (typeof centerLat !== "number" || typeof centerLng !== "number") {
    return NextResponse.json({ ok: true, blocked: true, reason: "sin_coordenadas", note: "Fija el centro de la cuadrícula (coordenadas) en la configuración del Rank Grid antes de medir." });
  }

  const keywords = parsed.data.keyword
    ? [parsed.data.keyword]
    : (await prisma.gmbKeyword.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, select: { keyword: true } })).map((k: any) => k.keyword);
  if (keywords.length === 0) return NextResponse.json({ ok: true, blocked: true, reason: "sin_keywords", note: "Añade keywords a la ficha antes de medir el Rank Grid." });

  let enqueued = 0;
  for (const kw of keywords) {
    const r = await enqueueRankJob(prisma, api.workspaceId, { clientId: client.id, keyword: kw, gridSize: cfg?.gridSize ?? 5, radiusKm: cfg?.radiusKm ?? 3, centerLat, centerLng, provider: cfg?.provider ?? "google_maps", actorId: api.userId ?? null });
    if (r.enqueued) enqueued++;
  }
  return NextResponse.json({ ok: true, blocked: false, enqueued, keywords: keywords.length, note: "Medición encolada. El worker la procesa en segundo plano; refresca para ver el progreso." });
});

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const jobs = await prisma.gmbRankJob.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, keyword: true, status: true, attempts: true, lastError: true, result: true, startedAt: true, finishedAt: true, createdAt: true } });
  const byStatus: Record<string, number> = {};
  for (const j of jobs) byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
  return NextResponse.json({ ok: true, jobs, byStatus, running: (byStatus.queued ?? 0) + (byStatus.running ?? 0) });
});
