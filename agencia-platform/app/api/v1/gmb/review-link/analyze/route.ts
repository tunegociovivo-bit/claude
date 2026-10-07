/**
 * POST /api/v1/gmb/review-link/analyze { query } — analiza un negocio (nombre + ciudad, URL de
 * Google Maps o Place ID) y devuelve sus coincidencias con el enlace directo de reseña de Google.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { analyzeBusiness } from "@/lib/gmb/review-funnel";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const query = String(body?.query ?? "").trim().slice(0, 300);
  if (query.length < 2) throw new ApiError(400, "validation_error", "Escribe el nombre del negocio (y mejor con la ciudad).");
  try {
    const places = await analyzeBusiness(api.workspaceId, query);
    return NextResponse.json({ ok: true, places });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "places_unavailable", message: String(e?.message ?? "error").slice(0, 300) });
  }
});
