/**
 * Cron Watchdog de AiAgentRun (Fase 50).
 *
 * Detecta runs en status=RUNNING que no han hecho tick en >10 min
 * (el runner actualiza lastIterationAt en cada vuelta del loop). Esos
 * son runs muertos por deploy/crash/OOM. Los marca REQUIRES_HUMAN con
 * un error claro para que el admin pueda relanzar (creando nueva task
 * manualmente o esperando al trigger original) sin que la task siga
 * "atascada".
 *
 * Llamar cada 5 min. Auth: CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { cronAuthOk } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

const STALE_MINUTES = 10;

function authed(req: NextRequest): boolean {
  return cronAuthOk(req);
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 503 });

  const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000);
  const stale = await prisma.aiAgentRun.updateMany({
    where: {
      status: "RUNNING",
      OR: [
        { lastIterationAt: { lt: cutoff } },
        // Runs que arrancaron pero NUNCA hicieron tick (raro pero pasa
        // si crashea antes de la primera iteración).
        { lastIterationAt: null, startedAt: { lt: cutoff } }
      ]
    },
    data: {
      status: "REQUIRES_HUMAN",
      finishedAt: new Date(),
      error: `Watchdog: run interrumpido (sin tick en ${STALE_MINUTES} min). Probable causa: el proceso del servidor se reinició a mitad del loop. Si la tarea sigue siendo relevante, el siguiente trigger periódico la procesará, o puedes crear una task nueva.`
    }
  });

  return NextResponse.json({ ok: true, markedStale: stale.count });
}

export const POST = GET;
