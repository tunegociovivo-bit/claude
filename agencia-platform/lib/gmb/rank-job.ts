/**
 * Job ASÍNCRONO del Rank Grid. Encolar es rápido; el worker (cron) mide con el adapter y persiste
 * los snapshots en GmbPosition (histórico). Tenant-scoped, idempotente, reintentos acotados con
 * backoff, cancelación segura. Si NO hay proveedor (sin clave), el job termina en error honesto
 * "sin_proveedor" — NUNCA inventa posiciones.
 */
import { resolveRankProvider, type RankProvider } from "./rank-adapter";

type PrismaLike = any;
export const MAX_RANK_ATTEMPTS = 3;

/** Encola una medición para (ficha, keyword). Idempotente: no duplica si ya hay una en curso. */
export async function enqueueRankJob(
  prisma: PrismaLike,
  workspaceId: string,
  opts: { clientId: string; keyword: string; gridSize?: number; radiusKm?: number; centerLat?: number | null; centerLng?: number | null; provider?: string; actorId?: string | null }
): Promise<{ enqueued: boolean; jobId?: string; reason?: string }> {
  const existing = await prisma.gmbRankJob.findFirst({ where: { workspaceId, clientId: opts.clientId, keyword: opts.keyword, status: { in: ["queued", "running"] } } });
  if (existing) return { enqueued: false, jobId: existing.id, reason: "ya_en_cola" };
  const job = await prisma.gmbRankJob.create({
    data: {
      workspaceId, clientId: opts.clientId, keyword: opts.keyword, status: "queued",
      provider: opts.provider ?? "google_maps", gridSize: opts.gridSize ?? 5, radiusKm: opts.radiusKm ?? 3,
      centerLat: opts.centerLat ?? null, centerLng: opts.centerLng ?? null, createdById: opts.actorId ?? null
    }
  });
  return { enqueued: true, jobId: job.id };
}

/** Cancela un job en cola (seguro; no toca los que ya corren). Tenant-scoped. */
export async function cancelRankJob(prisma: PrismaLike, workspaceId: string, jobId: string): Promise<boolean> {
  const res = await prisma.gmbRankJob.updateMany({ where: { id: jobId, workspaceId, status: "queued" }, data: { status: "cancelled", finishedAt: new Date() } });
  return (res.count ?? 0) > 0;
}

/**
 * Procesa hasta `max` jobs encolados. Resuelve el proveedor (honesto); si no hay, marca error.
 * Persiste cada medición en GmbPosition. Reintentos acotados con backoff (vuelve a "queued").
 */
export async function processRankJobs(
  prisma: PrismaLike,
  workspaceId: string,
  opts: { max?: number; provider?: RankProvider | null; resolveProvider?: (ws: string) => Promise<RankProvider | null>; now?: Date } = {}
): Promise<{ processed: number; errored: number; picked: number; noProvider: boolean }> {
  const now = opts.now ?? new Date();
  const jobs = await prisma.gmbRankJob.findMany({ where: { workspaceId, status: "queued" }, orderBy: { createdAt: "asc" }, take: opts.max ?? 2 });
  if (jobs.length === 0) return { processed: 0, errored: 0, picked: 0, noProvider: false };

  const provider = opts.provider !== undefined ? opts.provider : (opts.resolveProvider ? await opts.resolveProvider(workspaceId) : await resolveRankProvider(workspaceId));
  let processed = 0, errored = 0;

  for (const job of jobs) {
    await prisma.gmbRankJob.updateMany({ where: { id: job.id, workspaceId, status: "queued" }, data: { status: "running", startedAt: now } });
    // Sin proveedor → error honesto (no inventa nada).
    if (!provider) {
      await prisma.gmbRankJob.updateMany({ where: { id: job.id, workspaceId }, data: { status: "error", lastError: "sin_proveedor: configura la clave de Google Maps", finishedAt: now } });
      errored++;
      continue;
    }
    const client = await prisma.gmbClient.findFirst({ where: { id: job.clientId, workspaceId } });
    const lat = job.centerLat ?? client?.latitude;
    const lng = job.centerLng ?? client?.longitude;
    if (!client || typeof lat !== "number" || typeof lng !== "number") {
      await prisma.gmbRankJob.updateMany({ where: { id: job.id, workspaceId }, data: { status: "error", lastError: "sin_coordenadas: fija el centro de la cuadrícula", finishedAt: now } });
      errored++;
      continue;
    }
    try {
      const m = await provider.measure({ workspaceId, keyword: job.keyword, businessName: client.name, placeId: client.placeId || undefined, lat, lng, gridSize: job.gridSize, radiusKm: job.radiusKm });
      // Snapshot en GmbPosition (histórico). Cada medición es una fila nueva.
      await prisma.gmbPosition.create({ data: { workspaceId, clientId: job.clientId, keyword: job.keyword, avgPosition: m.avgPosition, top3Count: m.top3Count, foundCount: m.foundCount, cellCount: m.cellCount, gridData: m.cells, checkedAt: now } });
      await prisma.gmbRankJob.updateMany({ where: { id: job.id, workspaceId }, data: { status: "done", result: { avgPosition: m.avgPosition, top3Count: m.top3Count, foundCount: m.foundCount, cellCount: m.cellCount }, finishedAt: now } });
      processed++;
    } catch (e: any) {
      const nextAttempts = (Number(job.attempts) || 0) + 1;
      const status = nextAttempts >= MAX_RANK_ATTEMPTS ? "error" : "queued"; // backoff simple: reencola hasta MAX
      await prisma.gmbRankJob.updateMany({ where: { id: job.id, workspaceId }, data: { status, attempts: nextAttempts, lastError: String(e?.message ?? "error").slice(0, 160), ...(status === "error" ? { finishedAt: now } : {}) } });
      errored++;
    }
  }
  return { processed, errored, picked: jobs.length, noProvider: !provider };
}
