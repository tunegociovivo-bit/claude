/** GET /api/v1/gmb/shield/cases/[id]/evidence → acta de evidencias en PDF (registros con huella SHA-256). */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { buildEvidencePdf } from "@/lib/gmb/fake-reviews/pdf";
import { pdfFilename, reportBrand } from "@/lib/gmb/fake-reviews/brand";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const c = await prisma.gmbReviewCase.findFirst({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!c) throw new ApiError(404, "not_found", "Caso no encontrado");
  const ev = await prisma.gmbEvidence.findMany({ where: { workspaceId: api.workspaceId, caseId: c.id }, orderBy: { capturedAt: "asc" } });
  const pdf = await buildEvidencePdf({ ...c, reasons: (c.reasons as any[]) ?? [] }, ev, await reportBrand(api.workspaceId, api.userId));
  return new NextResponse(pdf as any, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${pdfFilename("evidencias", `${c.placeTitle}-${c.author}`)}"`, "Cache-Control": "no-store" }
  });
});
