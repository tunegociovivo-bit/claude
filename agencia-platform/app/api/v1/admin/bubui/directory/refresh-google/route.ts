/**
 * POST /api/v1/admin/bubui/directory/refresh-google
 * Body (opcional): { limit?: number }
 *
 * Refresca la nota de Google de los negocios (ordena los rankings del
 * directorio). Tope por llamada; repetible.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { runBubuiGoogleRatingRefresh } from "@/lib/bubui/directory-maintenance";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withApi({ scope: "*", rate: "admin" }, async (req) => {
  const body = (await req.json().catch(() => ({}))) as { limit?: number };
  const limit = Math.min(Math.max(body.limit ?? 25, 1), 100);
  const res = await runBubuiGoogleRatingRefresh(limit);
  return NextResponse.json({ ok: true, ...res });
});
