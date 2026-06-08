/**
 * Cron de tareas recurrentes.
 *
 * Escanea tareas con recurrence != "none" cuyo recurrenceNextAt ya venció y,
 * según el tipo de tarea:
 *   - Tareas de Sonia (en su proyecto buzón): crea un AiAgentRun PENDING y lo
 *     arranca en background (relanzar la IA), avanzando recurrenceNextAt.
 *   - Tareas NORMALES: las hace REAPARECER → mueve la fecha de entrega al slot
 *     que acaba de vencer, las reabre (si estaban en una columna "hecha" o
 *     completadas vuelven a la primera columna abierta y se limpia completedAt)
 *     y avanza recurrenceNextAt al siguiente slot. Así "se repiten" de verdad.
 *
 * Llamar cada 5-15 min. Seguridad: Bearer ${CRON_SECRET} o ?secret=...
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { loadAgentConfig } from "@/lib/ai/nv-ia/runner";
import { processRunInBackground } from "@/lib/ai/nv-ia/process-run";
import { computeRecurrenceNext, isValidRecurrence } from "@/lib/tasks/recurrence";
import { readKanbanColumns } from "@/lib/kanban";

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
    select: {
      id: true,
      workspaceId: true,
      projectId: true,
      recurrence: true,
      recurrenceNextAt: true,
      title: true,
      status: true,
      completedAt: true
    },
    take: 100
  });

  const cfgCache = new Map<string, { userId: string; inboxProjectId: string } | null>();
  // Columnas resueltas por proyecto: primera columna abierta + ids de columnas
  // "hechas", para reabrir bien las tareas normales sin mandarlas a una
  // columna inexistente.
  const colCache = new Map<string, { firstOpen: string; doneIds: Set<string> }>();
  const wsSettingsCache = new Map<string, any>();

  async function resolveCols(projectId: string, workspaceId: string) {
    const cached = colCache.get(projectId);
    if (cached) return cached;
    const proj = await prisma.project.findUnique({
      where: { id: projectId },
      select: { kanbanColumns: true } as any
    });
    const pc = (proj as any)?.kanbanColumns;
    let cols;
    if (Array.isArray(pc) && pc.length > 0) {
      cols = readKanbanColumns({ kanban: { columns: pc } });
    } else {
      let s = wsSettingsCache.get(workspaceId);
      if (s === undefined) {
        const ws = await prisma.workspace.findUnique({
          where: { id: workspaceId },
          select: { settings: true }
        });
        s = (ws as any)?.settings ?? null;
        wsSettingsCache.set(workspaceId, s);
      }
      cols = readKanbanColumns(s);
    }
    const open = cols.filter((c) => !c.isDone).sort((a, b) => a.order - b.order);
    const r = {
      firstOpen: open[0]?.id ?? "TODO",
      doneIds: new Set(cols.filter((c) => c.isDone).map((c) => c.id))
    };
    colCache.set(projectId, r);
    return r;
  }

  let triggered = 0;
  let advanced = 0;
  let repeated = 0;

  for (const t of due) {
    const recurrence = (t as any).recurrence as string;
    const oldNext = (t as any).recurrenceNextAt as Date | null;
    // Próximo slot (estrictamente futuro). Se avanza SIEMPRE para no acumular.
    const next = isValidRecurrence(recurrence)
      ? computeRecurrenceNext(recurrence, oldNext, now)
      : null;

    // ¿Es una tarea de Sonia (en su proyecto buzón)? Solo esas se relanzan
    // como un AiAgentRun; el resto son tareas normales que deben reaparecer.
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
    const isSoniaTask =
      !!cfg &&
      (t.projectId === cfg.inboxProjectId ||
        (await prisma.taskProject.count({ where: { taskId: t.id, projectId: cfg.inboxProjectId } })) > 0);

    if (isSoniaTask) {
      await prisma.task.update({ where: { id: t.id }, data: { recurrenceNextAt: next } as any });
      advanced++;

      // Dedupe: no crear otro run si ya hay uno en vuelo.
      const inFlight = await prisma.aiAgentRun.findFirst({
        where: { taskId: t.id, status: { in: ["PENDING", "RUNNING"] } },
        select: { id: true }
      });
      if (inFlight) continue;

      const run = await prisma.aiAgentRun.create({
        data: {
          workspaceId: t.workspaceId,
          taskId: t.id,
          status: "PENDING",
          trigger: "SCHEDULED" as any,
          triggerContext: "Tarea recurrente: relanzada automáticamente por su programación."
        }
      });
      // Arranca el procesado en background ya (igual que al crear una tarea de
      // Sonia a mano), sin depender de un cron `process` aparte.
      processRunInBackground(run.id);
      triggered++;
      continue;
    }

    // Tarea NORMAL: hazla reaparecer. Si estaba completada o en una columna
    // "hecha", vuelve a la primera columna abierta y se limpia completedAt.
    const { firstOpen, doneIds } = await resolveCols(t.projectId, t.workspaceId);
    const wasDone =
      (t as any).completedAt != null ||
      (t as any).status === "DONE" ||
      doneIds.has((t as any).status);
    await prisma.task.update({
      where: { id: t.id },
      data: {
        recurrenceNextAt: next,
        ...(oldNext ? { dueDate: oldNext } : {}),
        completedAt: null,
        ...(wasDone ? { status: firstOpen } : {})
      } as any
    });
    advanced++;
    repeated++;
  }

  return NextResponse.json({ ok: true, due: due.length, triggered, repeated, advanced });
}
