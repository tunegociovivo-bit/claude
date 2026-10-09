/**
 * GET /api/v1/gmb/clients/[id]/report/pdf?from=&to=&mode=real|cliente&fake=1
 * Descarga directa del informe de la ficha en PDF (generado en servidor).
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { buildClientReport } from "@/lib/gmb/client-report";
import { buildClientReportPdf } from "@/lib/gmb/client-report-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const url = new URL(req.url);
  const data = await buildClientReport(api.workspaceId, params.id, {
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    includeFake: url.searchParams.get("fake") === "1"
  });
  if (!data) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const mode = url.searchParams.get("mode") === "cliente" ? "cliente" : "real";
  const pdf = await buildClientReportPdf(data, mode);
  const slug = data.client.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 50);
  const name = `informe-${slug}-${data.period.from}-${data.period.to}${mode === "cliente" ? "-cliente" : ""}.pdf`;
  return new NextResponse(pdf as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store"
    }
  });
});
