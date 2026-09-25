/** GET /api/v1/gmb/fake-reviews/[id]/pdf?type=cliente|google|carta → PDF descargable (generado en servidor). */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { buildFakeReviewPdf, type PdfKind } from "@/lib/gmb/fake-reviews/pdf";
import { pdfFilename, reportBrand } from "@/lib/gmb/fake-reviews/brand";
import type { AnalysisResults } from "@/lib/gmb/fake-reviews/analyzer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const kind = (new URL(req.url).searchParams.get("type") ?? "cliente") as PdfKind;
  if (!["cliente", "google", "carta"].includes(kind)) throw new ApiError(400, "validation_error", "Tipo de PDF no válido");
  const row = await prisma.gmbFakeReviewAnalysis.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { status: true, results: true, clientName: true } });
  if (!row) throw new ApiError(404, "not_found", "Análisis no encontrado");
  if (row.status !== "done" || !row.results) throw new ApiError(409, "not_ready", "El análisis aún no ha terminado");
  const brand = await reportBrand(api.workspaceId, api.userId);
  const pdf = await buildFakeReviewPdf(kind, row.results as unknown as AnalysisResults, brand);
  return new NextResponse(pdf as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdfFilename(kind, row.clientName)}"`,
      "Cache-Control": "no-store"
    }
  });
});
