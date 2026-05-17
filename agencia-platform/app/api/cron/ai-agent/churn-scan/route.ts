/**
 * Cron Churn Scan (Fase 43).
 *
 * Detecta señales de fuga de cliente:
 *   - Actividad cayendo: <50% de tasks creadas en los últimos 30d vs
 *     los 30d anteriores (clientes con histórico de actividad).
 *   - Sin actividad nueva en 30+ días (cliente que estaba activo).
 *
 * Para cada cliente en riesgo crea task + AiAgentRun(CHURN_RISK).
 * Sonia puede iniciar workflow churn_recovery_14d, o redactar
 * outreach personalizado, o escalar al gestor.
 *
 * Dedupe 30 días por cliente.
 * Llamar semanal. Auth: CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

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

  const now = new Date();
  const w30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const w60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const dedupeSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const workspaces = await prisma.workspace.findMany({ select: { id: true, settings: true } });
  const results: any[] = [];

  for (const ws of workspaces) {
    const aiCfg = (ws.settings as any)?.aiAgent;
    if (!aiCfg?.inboxProjectId) continue;
    if (aiCfg?.churnScan?.enabled !== true) continue;

    // Top 50 clientes con actividad histórica (no escanea cada cliente
    // del workspace — solo los que tuvieron tracción significativa).
    const candidates = await prisma.client.findMany({
      where: { workspaceId: ws.id },
      select: { id: true, name: true },
      take: 100
    });

    let launchedThisWs = 0;
    for (const c of candidates) {
      if (launchedThisWs >= 5) break; // cap por cron

      // Dedupe
      const recentChurn = await prisma.aiAgentRun.findFirst({
        where: {
          workspaceId: ws.id,
          trigger: "CHURN_RISK",
          createdAt: { gte: dedupeSince },
          triggerContext: { contains: `client:${c.id}` }
        }
      });
      if (recentChurn) continue;

      const [tasksLast30, tasksPrev30] = await Promise.all([
        prisma.task.count({
          where: { workspaceId: ws.id, clientId: c.id, createdAt: { gte: w30 } }
        }),
        prisma.task.count({
          where: { workspaceId: ws.id, clientId: c.id, createdAt: { gte: w60, lt: w30 } }
        })
      ]);

      let signal: string | null = null;
      if (tasksPrev30 >= 3 && tasksLast30 === 0) {
        signal = `Cliente activo (${tasksPrev30} tasks en 30-60d atrás) sin actividad nueva en últimos 30d`;
      } else if (tasksPrev30 >= 5 && tasksLast30 / tasksPrev30 < 0.5) {
        signal = `Caída de actividad: ${tasksLast30} tasks últimos 30d vs ${tasksPrev30} los 30d anteriores (-${Math.round((1 - tasksLast30 / tasksPrev30) * 100)}%)`;
      }
      if (!signal) continue;

      const task = await prisma.task.create({
        data: {
          workspaceId: ws.id,
          projectId: aiCfg.inboxProjectId,
          clientId: c.id,
          title: `⚠️ Riesgo de churn — ${c.name}`,
          description:
            `Señal detectada por el cron de churn-scan:\n\n${signal}\n\n` +
            `Investiga qué está pasando (búsqueda semántica, último contacto, comentarios negativos). ` +
            `Si confirmas riesgo, considera iniciar workflow churn_recovery_14d con start_client_workflow ` +
            `o escalar al gestor de cuenta con notify_user.`,
          status: "TODO",
          priority: "HIGH"
        }
      });
      await prisma.aiAgentRun.create({
        data: {
          workspaceId: ws.id,
          taskId: task.id,
          status: "PENDING",
          trigger: "CHURN_RISK",
          triggerContext: `client:${c.id} signal:"${signal.slice(0, 100)}"`
        }
      });
      launchedThisWs++;
    }
    results.push({ workspaceId: ws.id, launched: launchedThisWs });
  }

  return NextResponse.json({ ok: true, results });
}

export const POST = GET;
