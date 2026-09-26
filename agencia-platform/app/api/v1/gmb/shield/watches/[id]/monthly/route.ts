/** GET /api/v1/gmb/shield/watches/[id]/monthly?month=YYYY-MM → informe mensual en PDF. */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { monthlyData, previousMonth } from "@/lib/gmb/fake-reviews/monthly";
import { buildMonthlyPdf } from "@/lib/gmb/fake-reviews/pdf";
import { pdfFilename, reportBrand } from "@/lib/gmb/fake-reviews/brand";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const m = new URL(req.url).searchParams.get("month") || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) throw new ApiError(400, "validation_error", "Mes no válido");
  const data = await monthlyData(api.workspaceId, params.id, m === "prev" ? previousMonth() : m);
  if (!data) throw new ApiError(404, "not_found", "Vigilancia no encontrada");
  const pdf = await buildMonthlyPdf(data, await reportBrand(api.workspaceId, api.userId));
  return new NextResponse(pdf as any, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${pdfFilename("mensual", `${data.name}-${data.month}`)}"`, "Cache-Control": "no-store" }
  });
});
