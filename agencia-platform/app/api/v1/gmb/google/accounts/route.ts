/**
 * GET /api/v1/gmb/google/accounts — cuentas GBP REALES accesibles con la conexión del
 * workspace. Si no hay conexión/credenciales o Google rechaza, devuelve un error legible
 * (no se inventa nada). Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { gmbListAccounts, parseGbpSource } from "@/lib/integrations/gmb";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  try {
    const source = parseGbpSource(new URL(req.url).searchParams.get("source"));
    const accounts = await gmbListAccounts(api.workspaceId, source);
    return NextResponse.json({ ok: true, accounts });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "gmb_unavailable", message: String(e?.message ?? "error").slice(0, 240) }, { status: 200 });
  }
});
