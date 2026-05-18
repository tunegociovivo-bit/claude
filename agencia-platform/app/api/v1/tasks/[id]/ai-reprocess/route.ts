/**
 * POST /api/v1/tasks/:id/ai-reprocess
 *
 * Re-dispara Sonia para una task SIN cookie de sesión — autenticado
 * con un Bearer token (env SONIA_REPROCESS_TOKEN). Pensado para que
 * Claude Code, tras resolver un issue de escalación, pueda relanzar
 * la task con el fix aplicado:
 *
 *   curl -X POST -H "Authorization: Bearer $SONIA_REPROCESS_TOKEN" \
 *     https://hub.negociovivo.app/api/v1/tasks/<id>/ai-reprocess?inline=0
 *
 * NO sustituye a /ai-process — ese sigue siendo el de UI (con cookie).
 * Este solo existe para automatización post-fix.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { processRunInBackground } from "@/lib/ai/nv-ia/process-run";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

function authed(req: NextRequest): boolean {
  const secret = process.env.SONIA_REPROCESS_TOKEN;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  if (!authed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const taskId = ctx.params.id;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, workspaceId: true, title: true }
  });
  if (!task) return NextResponse.json({ ok: false, error: "task_not_found" }, { status: 404 });

  // Dedupe sencillo: si ya hay PENDING/RUNNING, no crear otro — pero
  // SÍ despertar el PENDING por si estaba huérfano.
  const inFlight = await prisma.aiAgentRun.findFirst({
    where: {
      workspaceId: task.workspaceId,
      taskId,
      status: { in: ["PENDING", "RUNNING"] }
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true }
  });
  if (inFlight) {
    if (inFlight.status === "PENDING") processRunInBackground(inFlight.id);
    return NextResponse.json({
      ok: true,
      deduped: true,
      runId: inFlight.id,
      status: inFlight.status
    });
  }

  // ─── Cierre del run escalado anterior ──────────────────────────
  // Buscamos el último run REQUIRES_HUMAN de esta task (el que se
  // escaló a Claude). Si existe, lo marcamos humanReviewedAt=now —
  // así el badge azul "Claude mejorando" se apaga inmediatamente
  // en la UI, ANTES incluso de que el nuevo run arranque. Y le
  // notificamos al requester original que Claude terminó.
  const escalated = await prisma.aiAgentRun.findFirst({
    where: {
      workspaceId: task.workspaceId,
      taskId,
      status: "REQUIRES_HUMAN",
      humanReviewedAt: null
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, requesterId: true }
  });
  if (escalated) {
    await prisma.aiAgentRun.update({
      where: { id: escalated.id },
      data: { humanReviewedAt: new Date() }
    });
    if (escalated.requesterId) {
      await prisma.notification
        .create({
          data: {
            userId: escalated.requesterId,
            type: "ai_agent_escalation_resolved",
            body: `🛠 Claude terminó el fix del sistema. Sonia se está re-intentando con tu tarea${task.title ? ` "${task.title.slice(0, 80)}"` : ""} — espera la siguiente notificación.`,
            link: `/tareas?task=${taskId}`
          }
        })
        .catch(() => {});
    }
  }

  // Crea un run fresco con trigger=SELF_HEALING (que ya existe en el
  // enum). Marca semántica: "Claude reprocesó tras un fix de código".
  const run = await prisma.aiAgentRun.create({
    data: {
      workspaceId: task.workspaceId,
      taskId,
      requesterId: escalated?.requesterId ?? null,
      status: "PENDING",
      trigger: "SELF_HEALING" as any,
      triggerContext:
        "Re-disparado automáticamente tras un fix de código aplicado por Claude Code via escalación a GitHub."
    }
  });
  processRunInBackground(run.id);
  return NextResponse.json({ ok: true, runId: run.id, status: "PENDING" });
}
