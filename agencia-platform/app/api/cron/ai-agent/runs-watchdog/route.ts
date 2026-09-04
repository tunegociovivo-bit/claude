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
import { recoverRecentAnthropicBillingFailures } from "@/lib/ai/nv-ia/billing-recovery";

export const dynamic = "force-dynamic";

const STALE_MINUTES = 10;
const BILLING_RECOVERY_HOURS = 24;
const BILLING_RECOVERY_LIMIT = 20;

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

  // Anthropic can reject a run before Sonia has a chance to use any tool when
  // the provider account runs out of credit. Since the runner now falls back
  // to OpenAI, recover those recent runs automatically instead of making the
  // user press "Pedir a Sonia" again. A newer run for the same task is the
  // idempotency marker: only the newest failed attempt is replayed once.
  const recoveredBilling = await recoverRecentAnthropicBillingFailures({
    hours: BILLING_RECOVERY_HOURS,
    limit: BILLING_RECOVERY_LIMIT
  });

  return NextResponse.json({ ok: true, markedStale: stale.count, recoveredBilling });
}

export const POST = GET;
