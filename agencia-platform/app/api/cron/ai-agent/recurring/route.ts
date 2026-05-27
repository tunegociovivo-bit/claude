/**
 * Cron de tareas recurrentes de Sonia.
 *
 * Escanea tareas con recurrence != "none" cuyo recurrenceNextAt ya venció,
 * y crea un AiAgentRun PENDING (el cron /ai-agent/process lo ejecutará),
 * avanzando recurrenceNextAt al siguiente slot. Solo dispara para tareas que
 * están en el proyecto buzón de Sonia del workspace.
 *
 * Llamar cada 5-15 min. Seguridad: Bearer ${CRON_SECRET} o ?secret=...
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { loadAgentConfig } from "@/lib/ai/nv-ia/runner";
import { computeRecurrenceNext, isValidRecurrence } from "@/lib/tasks/recurrence";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 503 });

  const now = new Date();
  const due = await prisma.task.findMany({
    where: { recurrence: { not: "none" }, recurrenceNextAt: { lte: now }, deletedAt: null } as any,
    select: { id: true, workspaceId: true, projectId: true, recurrence: true, recurrenceNextAt: true, title: true },
    take: 100
  });

  const cfgCache = new Map<string, { userId: string; inboxProjectId: string } | null>();
  let triggered = 0;
  let advanced = 0;

  for (const t of due) {
    const recurrence = (t as any).recurrence as string;
    // Avanza el próximo slot SIEMPRE (aunque no dispare) para no acumular.
    const next = isValidRecurrence(recurrence)
      ? computeRecurrenceNext(recurrence, (t as any).recurrenceNextAt ?? null, now)
      : null;
    await prisma.task.update({ where: { id: t.id }, data: { recurrenceNextAt: next } as any });
    advanced++;

    // Solo relanzamos tareas de Sonia (en su proyecto buzón).
    let cfg = cfgCache.get(t.workspaceId);
    if (cfg === undefined) {
      try {
        const c = await loadAgentConfig(t.workspaceId);
        cfg = { userId: c.userId, inboxProjectId: c.inboxProjectId };
      } catch {
        cfg = null;
      }
      cfgCache.set(t.workspaceId, cfg);
    }
    if (!cfg) continue;

    const inInbox =
      t.projectId === cfg.inboxProjectId ||
      (await prisma.taskProject.count({ where: { taskId: t.id, projectId: cfg.inboxProjectId } })) > 0;
    if (!inInbox) continue;

    // Dedupe: no crear otro run si ya hay uno en vuelo.
    const inFlight = await prisma.aiAgentRun.findFirst({
      where: { taskId: t.id, status: { in: ["PENDING", "RUNNING"] } },
      select: { id: true }
    });
    if (inFlight) continue;

    await prisma.aiAgentRun.create({
      data: {
        workspaceId: t.workspaceId,
        taskId: t.id,
        status: "PENDING",
        trigger: "SCHEDULED" as any,
        triggerContext: "Tarea recurrente: relanzada automáticamente por su programación."
      }
    });
    triggered++;
  }

  return NextResponse.json({ ok: true, due: due.length, triggered, advanced });
}
