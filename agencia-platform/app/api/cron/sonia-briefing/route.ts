/**
 * Cron del "briefing proactivo de Sonia". La lógica vive en
 * lib/cron/scheduler.ts (runBriefing), compartida con el planificador
 * interno de la app (instrumentation.ts) — funciona sin cron externo.
 *
 * Seguridad: header `Authorization: Bearer <token>` o ?secret=… El token
 * aceptado es INTERNAL_CRON_TOKEN (la convención usada por el resto de crons
 * de GitHub Actions) o, por compatibilidad, CRON_SECRET.
 */
import { NextResponse } from "next/server";
import { runBriefing } from "@/lib/cron/scheduler";

export const dynamic = "force-dynamic";

function authorize(req: Request): boolean {
  // Aceptamos cualquiera de los dos secretos para no depender de que estén
  // ambos configurados: INTERNAL_CRON_TOKEN es el que ya usan backups y
  // recordatorios; CRON_SECRET se mantiene por compatibilidad.
  const accepted = [process.env.INTERNAL_CRON_TOKEN, process.env.CRON_SECRET].filter(
    (s): s is string => !!s
  );
  if (accepted.length === 0) return false;
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const query = new URL(req.url).searchParams.get("secret") ?? "";
  return accepted.some((s) => s === bearer || s === query);
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runBriefing();
  return NextResponse.json({ ok: true, ...result });
}
