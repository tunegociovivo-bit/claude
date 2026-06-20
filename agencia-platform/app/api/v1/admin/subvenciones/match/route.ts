/**
 * GET /api/v1/admin/subvenciones/match?clientId=...
 * Cruza el cliente con las convocatorias abiertas y devuelve las que encajan.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { matchForClient } from "@/lib/subvenciones/match";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const clientId = new URL(req.url).searchParams.get("clientId")?.trim();
  if (!clientId) throw new ApiError(400, "no_client", "Falta clientId");
  try {
    const matches = await matchForClient(api.workspaceId, clientId, api.userId);
    return NextResponse.json({ ok: true, matches });
  } catch (e: any) {
    throw new ApiError(400, "match_error", e?.message ?? "No se pudo cruzar.");
  }
});
