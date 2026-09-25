/**
 * GET  /api/v1/gmb/fake-reviews → historial de análisis del workspace
 * POST /api/v1/gmb/fake-reviews → crea un análisis y lo deja en cola:
 *      mode "manual" = cliente + 1–5 competidores; mode "auto" = sólo cliente, la herramienta descubre
 *      los negocios a los que varios autores de negativas han valorado positivamente.
 *
 * El análisis avanza con POST /[id]/step (polling desde la UI) y con el gmbTick del scheduler.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { initState } from "@/lib/gmb/fake-reviews/job";
import { placeFrom, type AnalysisParams } from "@/lib/gmb/fake-reviews/core";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const rows = await prisma.gmbFakeReviewAnalysis.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, clientId: true, clientName: true, label: true, status: true, progress: true, stepLabel: true,
      apiCalls: true, lastError: true, createdAt: true, finishedAt: true
    }
  });
  return NextResponse.json({ analyses: rows });
});

const placeSchema = z.object({
  title: z.string().min(1).max(300),
  address: z.string().max(500).optional().default(""),
  rating: z.number().nullable().optional(),
  reviews: z.number().int().nullable().optional(),
  type: z.string().max(200).optional().default(""),
  dataId: z.string().max(100).optional().default(""),
  placeId: z.string().max(200).optional().default(""),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  thumbnail: z.string().max(2000).optional().default("")
}).refine((p) => !!(p.dataId || p.placeId), "La ficha no tiene identificador de Google (data_id/place_id)");

const createSchema = z.object({
  mode: z.enum(["manual", "auto"]).default("manual"),
  minOverlap: z.number().int().min(2).max(20).default(2),
  clientId: z.string().max(60).optional(),
  client: placeSchema,
  competitors: z.array(placeSchema).max(5).default([]),
  negThreshold: z.number().int().min(1).max(3).default(2),
  posThreshold: z.number().int().min(4).max(5).default(4),
  windowDays: z.number().int().min(1).max(365).default(30),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).default(""),
  deep: z.boolean().default(true),
  maxDeep: z.number().int().min(1).max(300).default(80),
  ai: z.boolean().default(true)
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const b = parsed.data;
  const auto = b.mode === "auto";
  if (!auto && !b.competitors.length) throw new ApiError(400, "validation_error", "Añade al menos un competidor o usa la detección automática.");

  const key = (p: { dataId?: string; placeId?: string }) => p.dataId || p.placeId;
  if (b.competitors.some((c) => key(c) === key(b.client))) {
    throw new ApiError(400, "validation_error", "El cliente no puede ser también competidor.");
  }
  let clientId: string | null = null;
  if (b.clientId) {
    const c = await prisma.gmbClient.findFirst({ where: { id: b.clientId, workspaceId: api.workspaceId }, select: { id: true } });
    if (!c) throw new ApiError(404, "not_found", "Ficha no encontrada");
    clientId = c.id;
  }

  const params: AnalysisParams = {
    mode: b.mode,
    minOverlap: b.minOverlap,
    client: placeFrom(b.client),
    competitors: auto ? [] : b.competitors.map(placeFrom),
    negThreshold: b.negThreshold,
    posThreshold: b.posThreshold,
    windowDays: b.windowDays,
    dateFrom: b.dateFrom,
    deep: auto ? true : b.deep, // la detección automática necesita el historial de cada perfil
    ai: b.ai,
    maxClientPages: 15,
    maxCompPages: 25,
    maxDeep: b.maxDeep
  };
  const row = await prisma.gmbFakeReviewAnalysis.create({
    data: {
      workspaceId: api.workspaceId,
      clientId,
      clientName: params.client.title.slice(0, 250),
      label: (auto ? "Detección automática de competencia" : `vs ${params.competitors.map((c) => c.title).join(", ")}`).slice(0, 250),
      status: "running",
      stepLabel: "En cola",
      params: params as any,
      state: initState(params) as any,
      createdById: api.userId ?? null
    },
    select: { id: true }
  });
  return NextResponse.json({ id: row.id });
});
