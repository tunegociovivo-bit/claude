/** GET /api/v1/gmb/public/fake-reviews/[token]/pdf → PDF del informe para el cliente (enlace público firmado). */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { rateLimitPublic } from "@/lib/api/handler";
import { hashToken } from "@/lib/gmb/report-share";
import { buildFakeReviewPdf } from "@/lib/gmb/fake-reviews/pdf";
import { pdfFilename, reportBrand } from "@/lib/gmb/fake-reviews/brand";
import type { AnalysisResults } from "@/lib/gmb/fake-reviews/analyzer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const limited = rateLimitPublic(req, { tag: "fake-reviews-pdf", limit: 20 });
  if (limited) return limited;
  const row = await prisma.gmbFakeReviewAnalysis.findUnique({
    where: { shareTokenHash: hashToken(params.token ?? "") },
    select: { workspaceId: true, status: true, results: true, clientName: true, shareExpiresAt: true }
  });
  if (!row || row.status !== "done" || !row.results || !row.shareExpiresAt || row.shareExpiresAt < new Date()) {
    return NextResponse.json({ error: { code: "not_found", message: "Informe no disponible" } }, { status: 404 });
  }
  const brand = await reportBrand(row.workspaceId);
  const pdf = await buildFakeReviewPdf("cliente", row.results as unknown as AnalysisResults, { agency: brand.agency });
  return new Response(pdf as any, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${pdfFilename("cliente", row.clientName)}"`, "Cache-Control": "no-store" }
  });
}
