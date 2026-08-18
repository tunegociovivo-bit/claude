/**
 * GET /api/v1/gmb/google/accounts — cuentas GBP REALES accesibles con la conexión del
 * workspace. Si no hay conexión/credenciales o Google rechaza, devuelve un error legible
 * (no se inventa nada). Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { gmbListAccounts } from "@/lib/integrations/gmb";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  try {
    const accounts = await gmbListAccounts(api.workspaceId);
    return NextResponse.json({ ok: true, accounts });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "gmb_unavailable", message: String(e?.message ?? "error").slice(0, 240) }, { status: 200 });
  }
});
