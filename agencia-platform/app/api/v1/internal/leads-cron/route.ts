/**
 * Cron interno de NV Leads Pro. Dispara por workspace:
 *   - Process search batches pendientes
 *   - Process send queue (1 tick por workspace)
 *   - Process sequences
 *
 * Protegido por Bearer INTERNAL_CRON_TOKEN. Pensado para llamarse cada
 * minuto desde GitHub Actions o un cron de Railway.
 */

import { NextRequest, NextResponse } from "next/server";
import { runLeadsCronAllWorkspaces } from "@/lib/leads/cron";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const expected = process.env.INTERNAL_CRON_TOKEN ?? "";
  if (!expected || token !== expected) {
    return NextResponse.json({ error: { code: "bad_token", message: "Token inválido" } }, { status: 401 });
  }

  const report = await runLeadsCronAllWorkspaces();
  return NextResponse.json({ ok: true, workspaces: report });
}
