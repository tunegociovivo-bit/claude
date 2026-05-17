/**
 * Cron Workflow Tick (Fase 41).
 *
 * Recorre AiClientWorkflow ACTIVE. Para cada uno, si su próximo
 * paso ya tocó por dayOffset (días desde startedAt), dispara
 * AiAgentRun(WORKFLOW_STEP) con la instrucción del paso y avanza
 * nextStepIdx. Si era el último paso, marca el workflow COMPLETED.
 *
 * Llamar 1-2 veces al día. Auth: CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import type { WorkflowStep } from "@/lib/ai/nv-ia/workflows";

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
  const activeWorkflows = await prisma.aiClientWorkflow.findMany({
    where: { status: "ACTIVE" },
    include: {
      client: { select: { id: true, name: true } }
    }
  });

  const launched: any[] = [];

  for (const wf of activeWorkflows) {
    const steps = (wf.steps as unknown as WorkflowStep[]) ?? [];
    if (!Array.isArray(steps) || steps.length === 0) continue;
    if (wf.nextStepIdx >= steps.length) {
      // Era el último — completar.
      await prisma.aiClientWorkflow.update({
        where: { id: wf.id },
        data: { status: "COMPLETED", completedAt: now }
      });
      continue;
    }
    const step = steps[wf.nextStepIdx];
    const dueAt = new Date(wf.startedAt.getTime() + step.dayOffset * 24 * 60 * 60 * 1000);
    if (now < dueAt) continue;

    // Cargar config Sonia del workspace
    const ws = await prisma.workspace.findUnique({
      where: { id: wf.workspaceId },
      select: { settings: true }
    });
    const inboxProjectId = (ws?.settings as any)?.aiAgent?.inboxProjectId;
    if (!inboxProjectId) continue;

    // Crear task + run para este paso
    const task = await prisma.task.create({
      data: {
        workspaceId: wf.workspaceId,
        projectId: inboxProjectId,
        clientId: wf.clientId,
        title: `🔄 ${wf.workflowType} · ${step.label} — ${wf.client.name}`,
        description:
          `Paso ${wf.nextStepIdx + 1}/${steps.length} del workflow ${wf.workflowType} para ${wf.client.name}.\n\n` +
          `INSTRUCCIÓN:\n${step.prompt}\n\n` +
          `(Workflow iniciado el ${wf.startedAt.toISOString().slice(0, 10)}. ` +
          `dayOffset=${step.dayOffset}, próximo paso al avanzar este.)`,
        status: "TODO",
        priority: "MEDIUM"
      }
    });
    const run = await prisma.aiAgentRun.create({
      data: {
        workspaceId: wf.workspaceId,
        taskId: task.id,
        status: "PENDING",
        trigger: "WORKFLOW_STEP",
        triggerContext: `workflow:${wf.workflowType} step:${step.id} (${wf.nextStepIdx + 1}/${steps.length}) client:${wf.client.name}`
      }
    });

    // Avanzar nextStepIdx — si es el último, marcaremos COMPLETED en la
    // próxima iteración del cron (después de que la IA procese este).
    await prisma.aiClientWorkflow.update({
      where: { id: wf.id },
      data: { nextStepIdx: wf.nextStepIdx + 1 }
    });

    launched.push({ workflowId: wf.id, step: step.id, taskId: task.id, runId: run.id });
  }

  return NextResponse.json({ ok: true, launched: launched.length, items: launched });
}

export const POST = GET;
