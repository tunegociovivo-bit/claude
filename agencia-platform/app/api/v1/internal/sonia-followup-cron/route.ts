/** Dispara de forma durable las tareas programadas y vencidas de Sonia. */
import { NextRequest, NextResponse } from "next/server";
import { triggerDueScheduledFollowups } from "@/lib/ai/nv-ia/scheduled-followups";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const expected = process.env.INTERNAL_CRON_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: { code: "cron_disabled", message: "INTERNAL_CRON_TOKEN no configurado" } }, { status: 503 });
  }
  if (token !== expected) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Token inválido" } }, { status: 401 });
  }

  const now = new Date();
  const firedRunIds = await triggerDueScheduledFollowups(50);
  return NextResponse.json({ ok: true, now: now.toISOString(), fired: firedRunIds.length, firedRunIds });
}

export const GET = POST;
