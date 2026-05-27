/**
 * Cron Owner mode (Fase 31).
 *
 * Recorre las AiOwnership activas. Para cada una que pase de su
 * checkFreqDays sin lastCheckAt, crea una task "Owner check —
 * [cliente]" y un AiAgentRun(OWNER_MODE_CHECK). La IA revisa
 * estado, KPIs, identifica riesgos y propone acciones.
 *
 * Llamar diariamente. Auth: CRON_SECRET.
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
  const ownerships = await prisma.aiOwnership.findMany({
    where: { active: true },
    include: { client: { select: { id: true, name: true } } }
  });

  const launched: any[] = [];
  for (const o of ownerships) {
    if (o.lastCheckAt) {
      const dueAt = new Date(o.lastCheckAt.getTime() + o.checkFreqDays * 24 * 60 * 60 * 1000);
      if (now < dueAt) continue;
    }
    // Cargamos config de Sonia del workspace para usar el proyecto buzón
    const ws = await prisma.workspace.findUnique({
      where: { id: o.workspaceId },
      select: { settings: true }
    });
    const inboxProjectId = (ws?.settings as any)?.aiAgent?.inboxProjectId;
    if (!inboxProjectId) continue;

    const task = await prisma.task.create({
      data: {
        workspaceId: o.workspaceId,
        projectId: inboxProjectId,
        clientId: o.clientId,
        title: `🎯 Owner check semanal — ${o.client.name}`,
        description:
          `Revisión periódica del cliente bajo Owner mode.\n\nKPIs definidos:\n` +
          JSON.stringify(o.kpis, null, 2) +
          (o.lastStatus ? `\n\nÚltimo estado conocido:\n${o.lastStatus}` : "\n\nPrimera revisión."),
        status: "TODO",
        priority: "MEDIUM"
      }
    });
    const run = await prisma.aiAgentRun.create({
      data: {
        workspaceId: o.workspaceId,
        taskId: task.id,
        status: "PENDING",
        trigger: "OWNER_MODE_CHECK",
        triggerContext: `Owner mode check — cliente ${o.client.name}, KPIs: ${JSON.stringify(o.kpis)}`
      }
    });
    await prisma.aiOwnership.update({
      where: { id: o.id },
      data: { lastCheckAt: now }
    });
    launched.push({ clientId: o.clientId, taskId: task.id, runId: run.id });
  }

  return NextResponse.json({ ok: true, launched: launched.length, items: launched });
}

export const POST = GET;
