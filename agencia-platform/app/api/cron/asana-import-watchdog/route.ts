/**
 * Watchdog de imports de Asana.
 *
 * Recorre los AsanaImport en status=RUNNING y marca FAILED los que
 * llevan >10 minutos sin heartbeat (lastHeartbeatAt > 10min ago). El
 * importer hace heartbeat cada 25 tareas O al cambio de etapa, así
 * que 10min de silencio = el proceso ha muerto (deploy de Railway,
 * OOM, crash sin catch, request abortado).
 *
 * Sin este watchdog, un job muerto aparecería como RUNNING para
 * siempre, el UI esperaría indefinido y el user no sabría que tiene
 * que relanzar.
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
  if (!authed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 503 });
  }

  const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000);
  // Los RUNNING que NO han hecho heartbeat en STALE_MINUTES. Incluimos
  // también los que NUNCA hicieron heartbeat (lastHeartbeatAt=null) y
  // su startedAt es viejo — esos son jobs que empezaron pero el
  // importer murió antes del primer heartbeat (rarísimo pero pasa).
  const stale = await prisma.asanaImport.updateMany({
    where: {
      status: "RUNNING",
      OR: [
        { lastHeartbeatAt: { lt: cutoff } },
        { lastHeartbeatAt: null, startedAt: { lt: cutoff } }
      ]
    },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      errorMsg: `Watchdog: el proceso lleva más de ${STALE_MINUTES} min sin actualizar. Probablemente el server se reinició (deploy, crash, OOM). Relanza el import — es idempotente por asanaId y completará las tareas que faltan sin duplicar las ya importadas.`,
      currentStage: "Atascado — relanza el import"
    }
  });

  return NextResponse.json({
    ok: true,
    markedFailed: stale.count,
    cutoff: cutoff.toISOString()
  });
}

export const POST = GET;
