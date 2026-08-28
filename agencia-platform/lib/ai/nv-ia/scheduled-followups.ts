import { prisma } from "@/lib/db/prisma";
import { processRunInBackground } from "./process-run";
import { zonedTimeToUtc } from "./future-instructions/temporal";

const RECENT_RUN_MS = 24 * 60 * 60 * 1000;
const RECOVERY_WINDOW_MS = 6 * 60 * 60 * 1000;
const WEEKDAYS: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miércoles: 3, miercoles: 3, jueves: 4, viernes: 5, sábado: 6, sabado: 6 };

/** Corrige contradicciones obvias como «viernes 29» cuando el 29 es sábado. */
export function alignDueDateToExplicitWeekday(dueDate: Date, text: string): Date {
  const found = [...new Set(Object.entries(WEEKDAYS).filter(([name]) => new RegExp(`\\b${name}\\b`, "i").test(text)).map(([, day]) => day))];
  if (found.length !== 1 || dueDate.getUTCDay() === found[0]) return dueDate;
  const candidates = [-3, -2, -1, 1, 2, 3]
    .map((delta) => new Date(dueDate.getTime() + delta * 86_400_000))
    .filter((date) => date.getUTCDay() === found[0]);
  return candidates.sort((a, b) => Math.abs(a.getTime() - dueDate.getTime()) - Math.abs(b.getTime() - dueDate.getTime()))[0] ?? dueDate;
}

/** Corrige el error típico de guardar una hora española como si ya fuera UTC. */
export function alignDueDateToExplicitSpainTime(dueDate: Date, text: string): Date {
  const times = [...text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)].map((m) => `${m[1].padStart(2, "0")}:${m[2]}`);
  const unique = [...new Set(times)];
  if (unique.length !== 1) return dueDate;
  const [hour, minute] = unique[0].split(":").map(Number);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  if (formatter.format(dueDate) === unique[0]) return dueDate;
  // Solo corregimos cuando el modelo copió literalmente HH:MM en UTC.
  if (dueDate.getUTCHours() !== hour || dueDate.getUTCMinutes() !== minute) return dueDate;
  return zonedTimeToUtc(dueDate.getUTCFullYear(), dueDate.getUTCMonth() + 1, dueDate.getUTCDate(), hour, minute, "Europe/Madrid");
}

/** Dispara una task 🔁 vencida una sola vez, incluso si cron/timer/poll coinciden. */
export async function triggerScheduledFollowup(taskId: string): Promise<string | null> {
  const run = await prisma.$transaction(async (tx) => {
    const lock = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtext(${taskId})) AS locked
    `;
    if (!lock[0]?.locked) return null;
    const task = await tx.task.findFirst({
      where: {
        id: taskId,
        title: { startsWith: "🔁 " },
        dueDate: { gte: new Date(Date.now() - RECOVERY_WINDOW_MS), lte: new Date() },
        status: { notIn: ["DONE", "CANCELLED"] as any }
      },
      select: { id: true, workspaceId: true, dueDate: true, description: true }
    });
    if (!task) return null;
    const tracked = await tx.soniaScheduledInstruction.findUnique({
      where: { followupTaskId: taskId },
      select: { taskId: true, status: true, payload: true, sourceText: true }
    });
    if (tracked && tracked.status !== "SCHEDULED") return null;
    const legacyOriginId = !tracked
      ? task.description?.match(/Auto-creada por Sonia[^\n]*task\s+([a-z0-9]+)\)_\s*$/i)?.[1]
      : null;
    const legacyOrigin = legacyOriginId
      ? await tx.task.findFirst({
          where: { id: legacyOriginId, workspaceId: task.workspaceId },
          select: { id: true }
        })
      : null;
    const returnsToOriginal = !!tracked || !!legacyOrigin;
    const executionTaskId = tracked?.taskId ?? legacyOrigin?.id ?? taskId;
    if (!returnsToOriginal) {
      const recent = await tx.aiAgentRun.findFirst({
        where: { taskId, createdAt: { gte: new Date(Date.now() - RECENT_RUN_MS) } },
        select: { id: true }
      });
      if (recent) return null;
    }
    if (returnsToOriginal) {
      if (tracked) {
        await tx.soniaScheduledInstruction.update({
          where: { followupTaskId: taskId },
          data: { status: "TRIGGERED", triggeredAt: new Date(), attempts: { increment: 1 } }
        });
      }
      await tx.task.update({
        where: { id: taskId },
        data: { status: "DONE", completedAt: new Date() }
      });
    }
    return tx.aiAgentRun.create({
      data: {
        workspaceId: task.workspaceId,
        taskId: executionTaskId,
        status: "PENDING",
        trigger: "SCHEDULED" as any,
        triggerContext: returnsToOriginal
          ? [
              `Ejecución programada para ${task.dueDate?.toISOString()}.`,
              `IMPORTANTE: ejecuta la orden y devuelve comentarios y archivos en ESTA tarea original (${executionTaskId}); no crees otra tarea.`,
              `Instrucciones del temporizador auxiliar:`,
              task.description ?? JSON.stringify(tracked?.payload ?? {}),
              ...(tracked ? [`Petición original: ${tracked.sourceText}`] : [])
            ].join("\n\n")
          : `Followup programado por Sonia para ${task.dueDate?.toISOString()}.`
      },
      select: { id: true }
    });
  });
  if (!run) return null;
  void processRunInBackground(run.id);
  return run.id;
}

/** Recupera followups vencidos. Lo usan el cron y el polling autenticado. */
export async function triggerDueScheduledFollowups(limit = 50): Promise<string[]> {
  const due = await prisma.task.findMany({
    where: {
      title: { startsWith: "🔁 " },
      dueDate: { gte: new Date(Date.now() - RECOVERY_WINDOW_MS), lte: new Date() },
      status: { notIn: ["DONE", "CANCELLED"] as any }
    },
    select: { id: true },
    take: limit
  });
  const results = await Promise.all(due.map((task) => triggerScheduledFollowup(task.id)));
  return results.filter((id): id is string => !!id);
}

/** Repara followups futuros creados con un día de semana incompatible. */
export async function repairFutureScheduledFollowupDates(limit = 50): Promise<number> {
  const tasks = await prisma.task.findMany({
    where: { title: { startsWith: "🔁 " }, dueDate: { gt: new Date() }, status: { notIn: ["DONE", "CANCELLED"] as any } },
    select: { id: true, title: true, description: true, dueDate: true },
    take: limit
  });
  let repaired = 0;
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const text = `${task.title}\n${task.description ?? ""}`;
    const weekdayAligned = alignDueDateToExplicitWeekday(task.dueDate, text);
    const corrected = alignDueDateToExplicitSpainTime(weekdayAligned, text);
    if (corrected.getTime() === task.dueDate.getTime()) continue;
    await prisma.task.update({ where: { id: task.id }, data: { dueDate: corrected } });
    repaired++;
  }
  return repaired;
}

/** Ejecución casi exacta para encargos próximos; el cron sigue siendo respaldo durable. */
export function armScheduledFollowup(taskId: string, dueDate: Date): void {
  const delay = dueDate.getTime() - Date.now();
  if (delay <= 0 || delay > 24 * 60 * 60 * 1000) return;
  setTimeout(() => void triggerScheduledFollowup(taskId).catch((e) => console.warn("[sonia followup timer]", e)), delay + 250);
}
