/**
 * Cola ASÍNCRONA de identificación de titulares de franquicia.
 *
 * Por qué: `researchFranchiseOwner` hace llamadas de modelo con `web_search` (segundos por
 * lead). Hacerlas en serie dentro de una request HTTP excede el timeout del proxy → 502. Aquí
 * el endpoint solo ENCOLA (marca `rawData.franchiseOwner.status="queued"`) y devuelve rápido;
 * el cron procesa la cola en lotes pequeños, con:
 *   - aislamiento de errores POR LEAD (un fallo no tumba el resto),
 *   - reintentos ACOTADOS (MAX_ATTEMPTS) — al agotarlos → status "error" (terminal),
 *   - IDEMPOTENCIA (los "done" se saltan; re-encolar requiere force),
 *   - NUNCA sobrescribe un email ya existente,
 *   - todo TENANT-SCOPED (workspaceId en cada consulta/escritura).
 */
import { researchFranchiseOwner } from "./franchise-owner-enrichment";

type PrismaLike = any;
export const MAX_OWNER_ATTEMPTS = 2;

const isBrandLocation = (raw: any) => raw && raw.source === "brand_locations";

/** Marca leads brand_locations como "queued" para investigar en segundo plano. Rápido: no
 *  llama al modelo. Idempotente: salta los ya en cola o ya resueltos salvo `force`. */
export async function queueFranchiseOwnerResearch(
  prisma: PrismaLike,
  workspaceId: string,
  opts: { searchId?: string; ids?: string[]; force?: boolean; limit?: number; now?: Date }
): Promise<{ queued: number; skipped: number; scanned: number }> {
  const now = opts.now ?? new Date();
  const leads = await prisma.lead.findMany({
    where: { workspaceId, ...(opts.searchId ? { searchId: opts.searchId } : {}), ...(opts.ids?.length ? { id: { in: opts.ids } } : {}) },
    select: { id: true, rawData: true },
    take: opts.limit ?? 1000
  });
  let queued = 0;
  let skipped = 0;
  for (const lead of leads) {
    const raw: any = lead.rawData ?? {};
    if (!isBrandLocation(raw)) { skipped++; continue; }
    const fo: any = raw.franchiseOwner;
    const st = fo && typeof fo === "object" ? fo.status : null;
    if (!opts.force && (st === "queued" || st === "done")) { skipped++; continue; }
    await prisma.lead.updateMany({
      where: { id: lead.id, workspaceId },
      data: { rawData: { ...raw, franchiseOwner: { status: "queued", queuedAt: now.toISOString(), attempts: 0 } } }
    });
    queued++;
  }
  return { queued, skipped, scanned: leads.length };
}

/** Procesa hasta `max` leads encolados (llama al modelo). Aislado por lead, reintentos
 *  acotados, idempotente. Pensado para el cron (in-process, sin proxy → sin 502). */
export async function processFranchiseOwnerQueue(
  prisma: PrismaLike,
  workspaceId: string,
  opts: { max?: number; now?: Date } = {}
): Promise<{ processed: number; errored: number; picked: number }> {
  const now = opts.now ?? new Date();
  const leads = await prisma.lead.findMany({
    where: { workspaceId, rawData: { path: ["franchiseOwner", "status"], equals: "queued" } },
    select: { id: true, name: true, address: true, province: true, website: true, email: true, rawData: true },
    take: opts.max ?? 2
  });
  let processed = 0;
  let errored = 0;
  for (const lead of leads) {
    const raw: any = lead.rawData ?? {};
    const fo: any = raw.franchiseOwner ?? {};
    const attempts = Number(fo.attempts) || 0;
    try {
      const owner = await researchFranchiseOwner({
        workspaceId,
        brand: String(raw.brand ?? lead.name),
        storeName: lead.name,
        address: lead.address,
        province: lead.province,
        centralWebsite: lead.website
      });
      // NUNCA sobrescribir un email existente: solo rellena si el lead no tenía.
      const fillEmail = !lead.email && owner.emails?.[0] ? owner.emails[0] : undefined;
      await prisma.lead.updateMany({
        where: { id: lead.id, workspaceId },
        data: { rawData: { ...raw, franchiseOwner: { ...owner, status: "done", attempts, processedAt: now.toISOString() } }, ...(fillEmail ? { email: fillEmail } : {}) }
      });
      processed++;
    } catch (e: any) {
      // Fallo POR LEAD: reintenta hasta MAX; agotado → "error" terminal. No corta el lote.
      const nextAttempts = attempts + 1;
      const status = nextAttempts >= MAX_OWNER_ATTEMPTS ? "error" : "queued";
      await prisma.lead.updateMany({
        where: { id: lead.id, workspaceId },
        data: { rawData: { ...raw, franchiseOwner: { ...fo, status, attempts: nextAttempts, lastError: String(e?.message ?? "error").slice(0, 160) } } }
      });
      errored++;
    }
  }
  return { processed, errored, picked: leads.length };
}

/** Progreso (para la UI): cuántos en cola / hechos / con error. Tenant-scoped. */
export async function franchiseOwnerProgress(
  prisma: PrismaLike,
  workspaceId: string,
  searchId?: string
): Promise<{ queued: number; done: number; error: number }> {
  const scope: any = { workspaceId, ...(searchId ? { searchId } : {}) };
  const countBy = (status: string) => prisma.lead.count({ where: { ...scope, rawData: { path: ["franchiseOwner", "status"], equals: status } } });
  const [queued, done, error] = await Promise.all([countBy("queued"), countBy("done"), countBy("error")]);
  return { queued, done, error };
}
