/**
 * Monitor de crons. Registra el "latido" de cada cron y evalúa su salud frente
 * a la cadencia esperada. Lo alimenta cronAuthOk (cada hit autenticado graba
 * lastRunAt) y lo consume el watchdog + el panel de estado del sistema.
 */
import { prisma } from "@/lib/db/prisma";

/**
 * Catálogo: nombre del cron → minutos máximos que puede estar sin ejecutarse
 * antes de considerarse "mudo". El umbral es ~2-3x la cadencia real para
 * tolerar la imprecisión de los crons de GitHub Actions. El `name` coincide
 * con el path tras /api/cron/ (o /api/v1/internal/, /api/v1/gmb/).
 */
export const CRON_CATALOG: Record<string, { label: string; maxStaleMin: number }> = {
  "ai-agent/recurring": { label: "Tareas recurrentes (Sonia)", maxStaleMin: 35 },
  "bubui-review-requests": { label: "Bubui · reseña Google (10 min)", maxStaleMin: 25 },
  "calendar-sync": { label: "Sincronización de calendario", maxStaleMin: 45 },
  "bubui-offers-expiring": { label: "Bubui · cupones por caducar", maxStaleMin: 150 },
  "bubui-share-reminders": { label: "Bubui · recordatorio oferta-reto", maxStaleMin: 150 },
  "ab-testing-eval": { label: "Evaluación de A/B testing", maxStaleMin: 13 * 60 },
  "credential-watch": { label: "Vigilancia de credenciales", maxStaleMin: 13 * 60 },
  "bubui-birthday": { label: "Bubui · cupón de cumpleaños", maxStaleMin: 26 * 60 },
  "calendar-watch-renew": { label: "Renovación de watch de calendario", maxStaleMin: 26 * 60 },
  reindex: { label: "Reindexado de búsqueda", maxStaleMin: 26 * 60 },
  "sonia-briefing": { label: "Briefing diario de Sonia", maxStaleMin: 26 * 60 },
  "trash-purge": { label: "Purga de papelera", maxStaleMin: 26 * 60 },
  "health-watchdog": { label: "Vigilante de crons", maxStaleMin: 90 },
  "bubui-monthly-ranking": { label: "Bubui · premio ranking mensual", maxStaleMin: 26 * 60 }
};

/** Deriva el nombre de cron a partir del path de la request. */
export function cronNameFromPath(pathname: string): string | null {
  const m = /\/api\/(?:cron|v1\/internal|v1\/gmb)\/(.+?)\/?$/.exec(pathname);
  return m ? m[1] : null;
}

/** Graba el latido de un cron (fire-and-forget desde cronAuthOk). */
export async function recordCronRun(name: string): Promise<void> {
  await prisma.cronHeartbeat
    .upsert({
      where: { name },
      create: { name, lastRunAt: new Date(), runs: 1 },
      update: { lastRunAt: new Date(), runs: { increment: 1 } }
    })
    .catch(() => {});
}

export type CronHealth = {
  name: string;
  label: string;
  status: "ok" | "stale" | "never";
  lastRunAt: string | null;
  minutesSince: number | null;
  maxStaleMin: number;
};

/** Evalúa la salud de todos los crons del catálogo. */
export async function getCronsHealth(): Promise<CronHealth[]> {
  const beats = await prisma.cronHeartbeat.findMany();
  const byName = new Map(beats.map((b) => [b.name, b]));
  const now = Date.now();
  return Object.entries(CRON_CATALOG).map(([name, { label, maxStaleMin }]) => {
    const b = byName.get(name);
    if (!b) {
      return { name, label, status: "never" as const, lastRunAt: null, minutesSince: null, maxStaleMin };
    }
    const minutesSince = Math.round((now - b.lastRunAt.getTime()) / 60000);
    return {
      name,
      label,
      status: minutesSince > maxStaleMin ? ("stale" as const) : ("ok" as const),
      lastRunAt: b.lastRunAt.toISOString(),
      minutesSince,
      maxStaleMin
    };
  });
}
