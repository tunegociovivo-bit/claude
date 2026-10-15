import "server-only";
import { prisma } from "@/lib/prisma";
import { madridParts } from "@/lib/inbox/time";
import { isModuleEnabled } from "@/lib/modules";
import { acquireCronLease, releaseCronLease } from "@/lib/cron/distributed-lease";
import { enqueueRun, executeRun } from "./run";

// Programador del radar. Cada minuto:
//  1) para cada negocio con el módulo activo y una franja horaria que toca
//     ahora (y que no se haya lanzado ya hoy), encola una revisión;
//  2) procesa las revisiones en cola (una instancia a la vez por el lease).
// Clave de franja: "YYYY-MM-DD HH:MM" en hora de Madrid, guardada en
// RadarConfig.lastSlotKey, para no duplicar si el worker corre varias veces.

const STALE_RUN_MS = 25 * 60_000;

function slotKey(workspaceId: string, p: ReturnType<typeof madridParts>, time: string): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")} ${time}`;
}

/** Encola las revisiones programadas que tocan en este minuto. */
export async function scheduleDueRuns(now = new Date()): Promise<number> {
  const p = madridParts(now);
  const hhmm = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  const isoWeekday = p.weekday === 0 ? 7 : p.weekday; // 1=lunes … 7=domingo
  const configs = await prisma.radarConfig.findMany({
    where: { times: { has: hhmm }, days: { has: isoWeekday } },
  });
  let queued = 0;
  for (const config of configs) {
    const key = slotKey(config.workspaceId, p, hhmm);
    if (config.lastSlotKey === key) continue;
    if (!(await isModuleEnabled(config.workspaceId, "radar"))) continue;
    // Marca la franja de forma atómica (solo una instancia la gana).
    const claimed = await prisma.radarConfig.updateMany({
      where: { workspaceId: config.workspaceId, lastSlotKey: config.lastSlotKey },
      data: { lastSlotKey: key },
    });
    if (claimed.count !== 1) continue;
    const { runId } = await enqueueRun(config.workspaceId, "schedule");
    if (runId) queued++;
  }
  return queued;
}

/** Procesa una revisión en cola (la más antigua). Devuelve true si procesó alguna. */
export async function processQueuedRuns(max = 1): Promise<number> {
  let processed = 0;
  for (let i = 0; i < max; i++) {
    const run = await prisma.radarRun.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!run) break;
    await executeRun(run.id);
    processed++;
  }
  return processed;
}

/** Recupera revisiones «running» cuyo lease ha caducado (instancia caída). */
export async function recoverStaleRuns(): Promise<void> {
  await prisma.radarRun.updateMany({
    where: { status: "running", leaseUntil: { lt: new Date(Date.now() - STALE_RUN_MS) } },
    data: { status: "error", error: "La revisión se interrumpió y se marcó como fallida.", finishedAt: new Date(), leaseUntil: null },
  });
}

let busy = false;
const OWNER = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;

/** Un tick del programador (lo llama instrumentation-node). Lease global. */
export async function runRadarTick(): Promise<void> {
  if (busy) return;
  busy = true;
  let leased = false;
  try {
    leased = await acquireCronLease("radar/scheduler", OWNER, 4 * 60_000);
    if (!leased) return;
    await recoverStaleRuns();
    await scheduleDueRuns();
    await processQueuedRuns(1);
  } catch (error) {
    console.warn("[radar] tick:", (error as Error).message);
  } finally {
    if (leased) await releaseCronLease("radar/scheduler", OWNER).catch(() => undefined);
    busy = false;
  }
}
