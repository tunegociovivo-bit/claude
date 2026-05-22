/**
 * Cron del "briefing proactivo de Sonia". La lógica vive en
 * lib/cron/scheduler.ts (runBriefing), compartida con el planificador
 * interno de la app (instrumentation.ts) — funciona sin cron externo.
 *
 * Seguridad: header `Authorization: Bearer ${CRON_SECRET}` o ?secret=…
 */
import { NextResponse } from "next/server";
import { runBriefing } from "@/lib/cron/scheduler";

export const dynamic = "force-dynamic";

function authorize(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if ((req.headers.get("authorization") ?? "") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runBriefing();
  return NextResponse.json({ ok: true, ...result });
}
