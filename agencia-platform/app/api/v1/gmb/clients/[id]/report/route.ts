/**
 * GET /api/v1/gmb/clients/[id]/report?from=YYYY-MM-DD&to=YYYY-MM-DD&fake=1
 * Datos completos del informe de la ficha (ver lib/gmb/client-report). La página
 * /gmb-hub/report/[id] los presenta en modo «real» o «cliente»; ?fake=1 añade el último
 * análisis de reseñas falsas de la ficha.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { buildClientReport } from "@/lib/gmb/client-report";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const url = new URL(req.url);
  const data = await buildClientReport(api.workspaceId, params.id, {
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    includeFake: url.searchParams.get("fake") === "1"
  });
  if (!data) throw new ApiError(404, "not_found", "Ficha no encontrada");
  return NextResponse.json(data);
});
