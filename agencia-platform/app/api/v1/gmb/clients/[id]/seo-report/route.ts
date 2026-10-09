/**
 * Informe SEO competitivo de la ficha.
 *  GET  → último informe guardado (o null) + historial breve.
 *  POST { keyword?, topN? } → genera uno nuevo comparando con los mejor posicionados y lo guarda.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { buildSeoCompetitiveReport } from "@/lib/gmb/seo-competitive";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await prisma.gmbClient.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true } });
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const rows = await prisma.gmbSeoReport.findMany({
    where: { workspaceId: api.workspaceId, clientId: client.id },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { id: true, keyword: true, createdAt: true, data: true }
  });
  return NextResponse.json({
    ok: true,
    report: rows[0]?.data ?? null,
    reportId: rows[0]?.id ?? null,
    history: rows.map((r) => ({ id: r.id, keyword: r.keyword, createdAt: r.createdAt, position: (r.data as any)?.yourPosition ?? null, score: (r.data as any)?.scores?.total ?? null }))
  });
});

const schema = z.object({ keyword: z.string().max(120).optional(), topN: z.number().int().min(3).max(15).optional() });

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await prisma.gmbClient.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true } });
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const b = schema.safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new ApiError(400, "validation_error", b.error.message);
  try {
    const report = await buildSeoCompetitiveReport(api.workspaceId, client.id, { keyword: b.data.keyword?.trim() || undefined, topN: b.data.topN });
    const row = await prisma.gmbSeoReport.create({ data: { workspaceId: api.workspaceId, clientId: client.id, keyword: report.keyword, data: report as any } });
    return NextResponse.json({ ok: true, report, reportId: row.id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, message: String(e?.message ?? e).slice(0, 400) });
  }
});
