/**
 * Cron Co-CEO — revisión estratégica del workspace (Fase 40).
 *
 * Agrega métricas del último período (default 90 días) y dispara
 * un AiAgentRun(STRATEGIC_REVIEW). La IA produce un informe con:
 *   1. Análisis del período cerrado
 *   2. Predicción del siguiente
 *   3. 3 iniciativas concretas como subtareas
 *
 * Llamar al inicio de cada trimestre (o manualmente desde admin).
 * Idempotente: si ya hubo un STRATEGIC_REVIEW en los últimos 30 días
 * en este workspace, no dispara otro.
 *
 * Auth: CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === secret) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 503 });

  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 90, 7), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const dedupeSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const workspaces = await prisma.workspace.findMany({ select: { id: true, settings: true } });
  const launched: any[] = [];

  for (const ws of workspaces) {
    const aiCfg = (ws.settings as any)?.aiAgent;
    if (!aiCfg?.inboxProjectId) continue;
    // ¿Activado strategic review? Default: opt-in.
    if (aiCfg?.strategicReview?.enabled !== true) continue;

    // Dedupe 30 días
    const recent = await prisma.aiAgentRun.findFirst({
      where: {
        workspaceId: ws.id,
        trigger: "STRATEGIC_REVIEW",
        createdAt: { gte: dedupeSince }
      },
      select: { id: true }
    });
    if (recent) continue;

    // Agregamos métricas
    const [taskCount, taskDoneCount, clientCount, draftCount, draftExecuted, draftRejected, runsCount] =
      await Promise.all([
        prisma.task.count({ where: { workspaceId: ws.id, createdAt: { gte: since } } }),
        prisma.task.count({
          where: { workspaceId: ws.id, createdAt: { gte: since }, status: "DONE" }
        }),
        prisma.client.count({ where: { workspaceId: ws.id } }),
        prisma.aiDraft.count({ where: { workspaceId: ws.id, createdAt: { gte: since } } }),
        prisma.aiDraft.count({
          where: { workspaceId: ws.id, createdAt: { gte: since }, status: "EXECUTED" }
        }),
        prisma.aiDraft.count({
          where: { workspaceId: ws.id, createdAt: { gte: since }, status: "REJECTED" }
        }),
        prisma.aiAgentRun.count({ where: { workspaceId: ws.id, createdAt: { gte: since } } })
      ]);

    // Top 5 clientes por actividad (count de tasks en período)
    const topClientsRaw = await prisma.task.groupBy({
      by: ["clientId"],
      where: { workspaceId: ws.id, createdAt: { gte: since }, clientId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { clientId: "desc" } },
      take: 5
    });
    const topClients = await Promise.all(
      topClientsRaw.map(async (r) => {
        const c = await prisma.client.findUnique({
          where: { id: r.clientId! },
          select: { name: true }
        });
        return { name: c?.name ?? "(?)", taskCount: r._count._all };
      })
    );

    const metricsSummary = `
MÉTRICAS DEL PERÍODO (${days} días desde ${since.toISOString().slice(0, 10)}):

ACTIVIDAD:
- ${taskCount} tareas creadas, ${taskDoneCount} completadas (${taskCount > 0 ? Math.round((taskDoneCount / taskCount) * 100) : 0}%).
- ${clientCount} clientes activos totales.
- ${runsCount} runs de Sonia ejecutados.

Sonia:
- ${draftCount} borradores creados.
- ${draftExecuted} ejecutados, ${draftRejected} rechazados.
- Tasa de aprobación: ${
      draftExecuted + draftRejected > 0
        ? Math.round((draftExecuted / (draftExecuted + draftRejected)) * 100)
        : "—"
    }%.

TOP 5 CLIENTES POR ACTIVIDAD:
${topClients.map((c, i) => `${i + 1}. ${c.name} — ${c.taskCount} tareas`).join("\n")}
`;

    const task = await prisma.task.create({
      data: {
        workspaceId: ws.id,
        projectId: aiCfg.inboxProjectId,
        title: `📊 Revisión estratégica — ${new Date().toISOString().slice(0, 10)}`,
        description: metricsSummary,
        status: "TODO",
        priority: "HIGH"
      }
    });
    const run = await prisma.aiAgentRun.create({
      data: {
        workspaceId: ws.id,
        taskId: task.id,
        status: "PENDING",
        trigger: "STRATEGIC_REVIEW",
        triggerContext: `Período ${days}d. ${taskCount} tasks, ${draftCount} drafts, ${runsCount} runs.`
      }
    });
    launched.push({ workspaceId: ws.id, taskId: task.id, runId: run.id });
  }

  return NextResponse.json({ ok: true, launched: launched.length, items: launched });
}

export const POST = GET;
