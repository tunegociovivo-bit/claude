/**
 * GET /api/v1/admin/subvenciones
 * Estado del catálogo + lista de convocatorias abiertas + clientes (para el
 * selector del cruce).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { getAgencyProfile } from "@/lib/subvenciones/match";
import { CRON_CATALOG } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const now = new Date();
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const webhookUrl = (ws?.settings as any)?.subvenciones?.webhookUrl ?? "";
  const oportWebhookUrl = (ws?.settings as any)?.subvenciones?.oportWebhookUrl ?? "";
  const whatsappTo = (ws?.settings as any)?.subvenciones?.whatsappTo ?? "";
  const whatsappSession = (ws?.settings as any)?.subvenciones?.whatsappSession ?? "";
  const digestEnabled = (ws?.settings as any)?.subvenciones?.digestEnabled !== false;
  const savedAgencySearch = (ws?.settings as any)?.subvenciones?.savedAgencySearch;
  const savedAgencyMatches = Array.isArray(savedAgencySearch?.matches)
    ? savedAgencySearch.matches.filter((match: any) => !match?.fechaFin || new Date(match.fechaFin).getTime() >= now.getTime())
    : [];
  const { profile: agencyProfile } = await getAgencyProfile(api.workspaceId);
  const [abiertas, total, ultima, convocatorias, clients, heartbeat, sources] = await Promise.all([
    prisma.subvencionConvocatoria.count({ where: { abierta: true, OR: [{ fechaFin: null }, { fechaFin: { gte: now } }] } }),
    prisma.subvencionConvocatoria.count(),
    prisma.subvencionConvocatoria.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    prisma.subvencionConvocatoria.findMany({
      where: { abierta: true, OR: [{ fechaFin: null }, { fechaFin: { gte: now } }] },
      orderBy: { fechaFin: "asc" },
      take: 100,
      select: { id: true, titulo: true, organo: true, regiones: true, importeTotal: true, fechaFin: true, urlBases: true, fuente: true }
    }),
    prisma.client.findMany({ where: { workspaceId: api.workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.cronHeartbeat.findUnique({ where: { name: "subvenciones" } }),
    prisma.subvencionConvocatoria.groupBy({ by: ["fuente"], _count: { _all: true } })
  ]);
  const health = (ws?.settings as any)?.subvenciones?.health ?? {};
  const sourceCount = new Map(sources.map((x) => [x.fuente.toLowerCase(), x._count._all]));
  const bdnsCount = sourceCount.get("bdns") ?? 0;
  const sourceCoverage = [
    { source: "bdns", label: "BDNS estatal y autonómica", count: bdnsCount, connected: bdnsCount > 0 },
    { source: "curada", label: "Programas curados", count: sourceCount.get("curada") ?? 0, connected: (sourceCount.get("curada") ?? 0) > 0 },
    { source: "boja", label: "BOJA · cobertura oficial mediante BDNS", count: bdnsCount, connected: bdnsCount > 0, detail: "Las convocatorias andaluzas publicadas en BOJA se consolidan por su identificador BDNS." },
    { source: "placsp", label: "PLACSP · licitaciones públicas", count: sourceCount.get("placsp") ?? 0, connected: (sourceCount.get("placsp") ?? 0) > 0 },
    { source: "camaras", label: "Cámaras de Comercio · cobertura oficial mediante BDNS", count: sourceCount.get("camaras") ?? 0, connected: (sourceCount.get("camaras") ?? 0) > 0, detail: "Las ayudas camerales se obtienen mediante el Sistema Nacional de Publicidad de Subvenciones, sin automatizar la sede de tramitación." },
    { source: "fondos-eu", label: "Fondos europeos", count: sourceCount.get("fondos-eu") ?? 0, connected: (sourceCount.get("fondos-eu") ?? 0) > 0 }
  ];
  const maxStaleMin = CRON_CATALOG.subvenciones.maxStaleMin;
  const minutesSince = heartbeat ? Math.round((Date.now() - heartbeat.lastRunAt.getTime()) / 60000) : null;
  return NextResponse.json({
    abiertas,
    total,
    ultimaActualizacion: ultima?.updatedAt ?? null,
    convocatorias,
    clients,
    webhookUrl,
    oportWebhookUrl,
    whatsappTo,
    whatsappSession,
    digestEnabled,
    savedAgencyMatches,
    savedAgencySearchAt: typeof savedAgencySearch?.savedAt === "string" ? savedAgencySearch.savedAt : null,
    sources: sources.map((x) => ({ source: x.fuente, count: x._count._all })),
    sourceCoverage,
    agencyProfile,
    health: {
      ...health,
      cron: { status: !heartbeat ? "never" : minutesSince! > maxStaleMin ? "stale" : "ok", lastRunAt: heartbeat?.lastRunAt ?? null, runs: heartbeat?.runs ?? 0, minutesSince }
    }
  });
});

// Guarda los webhooks de Make (avisos) y/o el perfil de la agencia (Negocio Vivo).
export const PATCH = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = z.object({
    webhookUrl: z.string().max(500).nullable().optional(),
    oportWebhookUrl: z.string().max(500).nullable().optional(),
    whatsappTo: z.string().max(40).nullable().optional(),
    whatsappSession: z.string().max(60).nullable().optional(),
    agencyProfile: z.string().max(4000).nullable().optional()
    ,digestEnabled: z.boolean().optional()
  }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = ws?.settings ?? {};
  settings.subvenciones = settings.subvenciones ?? {};
  if (parsed.data.webhookUrl !== undefined) settings.subvenciones.webhookUrl = (parsed.data.webhookUrl ?? "").trim();
  if (parsed.data.oportWebhookUrl !== undefined) settings.subvenciones.oportWebhookUrl = (parsed.data.oportWebhookUrl ?? "").trim();
  if (parsed.data.whatsappTo !== undefined) settings.subvenciones.whatsappTo = (parsed.data.whatsappTo ?? "").trim();
  if (parsed.data.whatsappSession !== undefined) settings.subvenciones.whatsappSession = (parsed.data.whatsappSession ?? "").trim();
  if (parsed.data.agencyProfile !== undefined) settings.subvenciones.agencyProfile = (parsed.data.agencyProfile ?? "").trim();
  if (parsed.data.digestEnabled !== undefined) settings.subvenciones.digestEnabled = parsed.data.digestEnabled;
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true });
});
