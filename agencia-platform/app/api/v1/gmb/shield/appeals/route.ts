/**
 * Apelaciones en lote (Google admite hasta 10 reseñas por apelación y una apelación por reseña).
 * GET  → lotes pendientes: reseñas «rechazadas» agrupadas por ficha en grupos de 10
 * POST {caseIds}          → redacta la apelación conjunta (IA con toda la evidencia) y la asigna al lote
 * PATCH {batchId}         → marca el lote como enviado (estado «apelada»)
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { appealBatches } from "@/lib/gmb/fake-reviews/cases-logic";
import { appealText } from "@/lib/gmb/fake-reviews/cases";
import { getLearningStats } from "@/lib/gmb/fake-reviews/shield";
import { reportBrand } from "@/lib/gmb/fake-reviews/brand";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const rows = await prisma.gmbReviewCase.findMany({
    where: { workspaceId: api.workspaceId, status: "rechazada", target: "cliente" },
    orderBy: { rejectedAt: "asc" },
    select: { id: true, placeKey: true, placeTitle: true, status: true, author: true, rating: true, reviewDate: true, appealBatch: true, appealText: true }
  });
  const batches = appealBatches(rows).map((list) => ({
    placeKey: list[0].placeKey,
    placeTitle: list[0].placeTitle,
    batchId: list.every((c) => c.appealBatch && c.appealBatch === list[0].appealBatch) ? list[0].appealBatch : null,
    text: list.every((c) => c.appealBatch && c.appealBatch === list[0].appealBatch) ? list[0].appealText : null,
    cases: list.map(({ appealText: _t, ...c }) => c)
  }));
  return NextResponse.json({ batches });
});

export const POST = withApi({ scope: "*", rate: "ai" }, async (req, { api }) => {
  const p = z.object({ caseIds: z.array(z.string()).min(1).max(10) }).safeParse(await req.json().catch(() => null));
  if (!p.success) throw new ApiError(400, "validation_error", "Indica entre 1 y 10 reseñas");
  const cases = await prisma.gmbReviewCase.findMany({ where: { workspaceId: api.workspaceId, id: { in: p.data.caseIds } } });
  if (!cases.length) throw new ApiError(404, "not_found", "Reseñas no encontradas");
  if (new Set(cases.map((c) => c.placeKey)).size > 1) throw new ApiError(400, "validation_error", "Una apelación sólo puede incluir reseñas de la misma ficha.");
  const brand = await reportBrand(api.workspaceId, api.userId);
  const signer = `${brand.contact ? `${brand.contact}\n` : ""}${brand.agency}, en nombre del titular de ${cases[0].placeTitle}`;
  const text = await appealText(api.workspaceId, api.userId ?? null, cases, signer, await getLearningStats(api.workspaceId).catch(() => null));
  const batchId = randomUUID().slice(0, 8);
  await prisma.gmbReviewCase.updateMany({ where: { workspaceId: api.workspaceId, id: { in: cases.map((c) => c.id) } }, data: { appealBatch: batchId, appealText: text } });
  return NextResponse.json({ batchId, text });
});

export const PATCH = withApi({ scope: "*" }, async (req, { api }) => {
  const p = z.object({ batchId: z.string().min(4).max(40), text: z.string().max(20000).optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success) throw new ApiError(400, "validation_error", "Lote no válido");
  const now = new Date();
  const r = await prisma.gmbReviewCase.updateMany({
    where: { workspaceId: api.workspaceId, appealBatch: p.data.batchId, status: { in: ["rechazada", "denunciada"] } },
    data: { status: "apelada", appealedAt: now, nextCheckAt: new Date(now.getTime() + 3 * 86_400_000), checkMisses: 0, ...(p.data.text ? { appealText: p.data.text } : {}) }
  });
  return NextResponse.json({ ok: true, updated: r.count });
});
