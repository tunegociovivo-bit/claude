/**
 * Cron de NV IA: procesa AiAgentRun en PENDING.
 *
 * Debe llamarse cada 1-2 min (GitHub Actions / Railway cron). Coge
 * hasta N runs PENDING de cualquier workspace, los marca RUNNING,
 * ejecuta el agent loop, persiste el resultado, y notifica al
 * requester si está definido.
 *
 * Tope por invocación: por defecto 3 runs simultáneos. Cada uno tarda
 * decenas de segundos a minutos (depende de los tool calls de Claude).
 * Mantener el tope bajo evita timeouts del cron (Railway/GH Actions
 * suelen tener 10-15 min por job).
 *
 * Seguridad: header `Authorization: Bearer ${CRON_SECRET}` o
 * `?secret=...`. Sin secret → 503.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { executeAgentRun, loadAgentConfig } from "@/lib/ai/nv-ia/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10 min — agent loops pueden tardar

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === secret) return true;
  return false;
}

async function processOne(runId: string) {
  // Marcar RUNNING (con startedAt). Lock optimista: solo si sigue PENDING.
  const claimed = await prisma.aiAgentRun.updateMany({
    where: { id: runId, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date() }
  });
  if (claimed.count === 0) return { skipped: true, runId };

  const run = await prisma.aiAgentRun.findUnique({ where: { id: runId } });
  if (!run) return { skipped: true, runId };

  try {
    const config = await loadAgentConfig(run.workspaceId);
    const result = await executeAgentRun({
      workspaceId: run.workspaceId,
      taskId: run.taskId,
      config
    });

    await prisma.aiAgentRun.update({
      where: { id: runId },
      data: {
        status: result.status as any,
        summary: result.summary,
        error: result.error,
        log: result.log as any,
        stepsCount: result.stepsCount,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        finishedAt: new Date()
      }
    });

    // Notificar al requester (si hay) — un mensaje breve con link a la tarea.
    if (run.requesterId) {
      const link = `/tasks/${run.taskId}`;
      const body =
        result.status === "SUCCEEDED"
          ? `✅ NV IA terminó: ${result.summary?.slice(0, 140) ?? ""}`
          : result.status === "REQUIRES_HUMAN"
          ? `⚠️ NV IA necesita tu ayuda con una tarea — revisa los comentarios.`
          : `❌ NV IA falló al procesar una tarea: ${result.error?.slice(0, 140) ?? "error desconocido"}`;
      await prisma.notification.create({
        data: {
          userId: run.requesterId,
          type: "ai_agent_run",
          body,
          link
        }
      }).catch(() => {});
    }

    return { runId, status: result.status, steps: result.stepsCount };
  } catch (e: any) {
    await prisma.aiAgentRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        error: String(e?.message ?? e),
        finishedAt: new Date()
      }
    }).catch(() => {});
    return { runId, status: "FAILED", error: String(e?.message ?? e) };
  }
}

export async function GET(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 503 });
  }
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 3, 1), 10);

  // Cogemos los más antiguos primero (FIFO).
  const pending = await prisma.aiAgentRun.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true }
  });

  if (pending.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const results = [];
  for (const p of pending) {
    results.push(await processOne(p.id));
  }
  return NextResponse.json({ ok: true, processed: results.length, results });
}

export const POST = GET;
