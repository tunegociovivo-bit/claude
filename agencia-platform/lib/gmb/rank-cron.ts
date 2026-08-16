/**
 * Worker de jobs del Rank Grid para el planificador interno. Procesa, por workspace con jobs en
 * cola, unas pocas mediciones por tick (bounded). Tenant-scoped por construcción.
 */
import { prisma } from "@/lib/db/prisma";
import { processRankJobs } from "./rank-job";

export async function processAllRankJobs(maxPerWorkspace = 2): Promise<{ workspaces: number; processed: number; errored: number }> {
  // Workspaces con jobs en cola (distintos).
  const queued = await prisma.gmbRankJob.findMany({ where: { status: "queued" }, select: { workspaceId: true }, take: 500 });
  const workspaceIds = [...new Set(queued.map((j: any) => j.workspaceId))];
  let processed = 0, errored = 0;
  for (const ws of workspaceIds) {
    try {
      const r = await processRankJobs(prisma, ws, { max: maxPerWorkspace });
      processed += r.processed;
      errored += r.errored;
      if (r.picked > 0) console.info(`[gmb-rank] ws=${ws} picked=${r.picked} done=${r.processed} error=${r.errored} noProvider=${r.noProvider}`);
    } catch (e: any) {
      console.warn(`[gmb-rank] ws=${ws} FALLO: ${String(e?.message ?? e).slice(0, 120)}`);
    }
  }
  return { workspaces: workspaceIds.length, processed, errored };
}
