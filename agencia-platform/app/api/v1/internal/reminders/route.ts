/**
 * Endpoint interno (cron externo opcional) para recordatorios de tareas que
 * vencen + eventos del calendario próximos. La lógica vive en
 * lib/cron/scheduler.ts (runReminders), que TAMBIÉN ejecuta el planificador
 * interno de la app (instrumentation.ts) — así funciona sin cron externo.
 *
 * Protegido por bearer: header `Authorization: Bearer <INTERNAL_CRON_TOKEN>`.
 */
import { NextRequest, NextResponse } from "next/server";
import { runReminders } from "@/lib/cron/scheduler";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const expected = process.env.INTERNAL_CRON_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: { code: "cron_disabled", message: "INTERNAL_CRON_TOKEN no configurado" } },
      { status: 503 }
    );
  }
  if (token !== expected) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Token inválido" } }, { status: 401 });
  }
  const result = await runReminders();
  return NextResponse.json({ ok: true, ...result });
}
