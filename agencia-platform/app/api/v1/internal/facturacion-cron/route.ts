/**
 * Cron interno de remesas SEPA. Protegido por Bearer INTERNAL_CRON_TOKEN.
 * Caduca enlaces vencidos y (si SEPA_AUTO_SCAN=true) detecta candidatas.
 * Pensado para llamarse periódicamente desde el cron de Railway/GitHub Actions.
 */
import { NextRequest, NextResponse } from "next/server";
import { runSepaCronAllWorkspaces } from "@/lib/facturacion/sepa/cron";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const expected = process.env.INTERNAL_CRON_TOKEN ?? "";
  if (!expected || token !== expected) {
    return NextResponse.json({ error: { code: "bad_token", message: "Token inválido" } }, { status: 401 });
  }
  const report = await runSepaCronAllWorkspaces();
  return NextResponse.json({ ok: true, workspaces: report });
}
