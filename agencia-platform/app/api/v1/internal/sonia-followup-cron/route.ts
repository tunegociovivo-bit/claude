/**
 * Cron: dispara tasks programadas por Sonia con schedule_followup.
 *
 * Sonia crea tasks con título prefijo "🔁 " y dueDate en el futuro.
 * Este cron, ejecutado cada N minutos por GitHub Actions, busca esas
 * tasks cuya dueDate ya pasó y crea un AiAgentRun PENDING + dispara
 * processRunInBackground.
 *
 * Idempotencia: solo crea run si la task NO tiene un AiAgentRun en
 * las últimas 24h. Así, si el cron corre 2 veces seguidas, no se
 * duplica el run.
 *
 * Marcamos el run con trigger=SCHEDULED para que en el dashboard se
 * distinga de los MANUAL/MENTION.
 *
 * Frecuencia recomendada: cada 5-10 min vía cron de GitHub Actions
 * apuntando aquí con bearer INTERNAL_CRON_TOKEN.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { processRunInBackground } from "@/lib/ai/nv-ia/process-run";

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
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Token inválido" } },
      { status: 401 }
    );
  }

  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Buscar tasks programadas por Sonia (prefix 🔁) cuya dueDate ya
  // pasó y no estén DONE/CANCELLED.
  const due = await prisma.task.findMany({
    where: {
      title: { startsWith: "🔁 " },
      dueDate: { lte: now },
      status: { notIn: ["DONE", "CANCELLED"] as any }
    },
    select: { id: true, workspaceId: true, title: true, dueDate: true },
    take: 50
  });

  const fired: Array<{ taskId: string; runId: string; title: string }> = [];
  const skipped: Array<{ taskId: string; reason: string }> = [];

  for (const t of due) {
    // ¿Hay un AiAgentRun reciente para esta task?
    const recentRun = await prisma.aiAgentRun.findFirst({
      where: { taskId: t.id, createdAt: { gte: since24h } },
      select: { id: true, status: true }
    });
    if (recentRun) {
      skipped.push({ taskId: t.id, reason: `ya hay run ${recentRun.id} (${recentRun.status})` });
      continue;
    }

    const run = await prisma.aiAgentRun.create({
      data: {
        workspaceId: t.workspaceId,
        taskId: t.id,
        status: "PENDING",
        trigger: "SCHEDULED" as any,
        triggerContext: `Followup programado por Sonia para ${t.dueDate?.toISOString()}.`
      }
    });
    fired.push({ taskId: t.id, runId: run.id, title: t.title });
    processRunInBackground(run.id);
  }

  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    candidates: due.length,
    fired: fired.length,
    firedRuns: fired,
    skipped
  });
}

// Para Vercel-style cron también ofrecemos GET con el mismo guard.
export const GET = POST;
