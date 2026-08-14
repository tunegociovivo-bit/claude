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
// Clasificación de estado y evidencia: fuente ÚNICA compartida con la API de listado y la UI.
import { ownerHasEvidence, classifyOwnerState, type OwnerState } from "./franchise-owner-view";
export { ownerHasEvidence, classifyOwnerState, type OwnerState };

type PrismaLike = any;
export const MAX_OWNER_ATTEMPTS = 2;

export type SkippedReasons = { alreadyEnriched: number; running: number; error: number; staleEmpty: number };

/**
 * Encola para investigar los leads de un objetivo EXPLÍCITO (una búsqueda concreta o unos ids),
 * SIEMPRE dentro del workspace. No exige que sean `brand_locations`: cuando el usuario pulsa el
 * botón sobre una búsqueda de locales, investiga esos leads por su DIRECCIÓN + el nombre de la
 * MARCA (keyword de la búsqueda, nunca la central). Rápido (no llama al modelo). Idempotente.
 * Tenant + búsqueda estrictos: solo toca leads del workspace y del searchId/ids indicados.
 */
export async function queueFranchiseOwnerResearch(
  prisma: PrismaLike,
  workspaceId: string,
  opts: { searchId?: string; ids?: string[]; force?: boolean; retryErrors?: boolean; retryEmpty?: boolean; limit?: number; now?: Date }
): Promise<{ queued: number; skipped: number; scanned: number; skippedReasons: SkippedReasons }> {
  const now = opts.now ?? new Date();
  // SCOPING ESTRICTO: workspace + (searchId | ids). Nunca toca leads fuera de ese objetivo.
  const leads = await prisma.lead.findMany({
    where: { workspaceId, ...(opts.searchId ? { searchId: opts.searchId } : {}), ...(opts.ids?.length ? { id: { in: opts.ids } } : {}) },
    select: { id: true, searchId: true, rawData: true },
    take: opts.limit ?? 1000
  });
  // Marca = keyword de la(s) búsqueda(s) implicada(s). Se pasa al investigador para acotar por
  // marca sin usar la central. Los leads `brand_locations` ya llevan rawData.brand (prioritario).
  const brandBySearch = new Map<string, string>();
  const searchIds = [...new Set([opts.searchId, ...leads.map((l: any) => l.searchId)].filter(Boolean))] as string[];
  if (searchIds.length) {
    const searches = await prisma.leadSearch.findMany({ where: { workspaceId, id: { in: searchIds } }, select: { id: true, keyword: true } });
    searches.forEach((s: any) => brandBySearch.set(s.id, s.keyword));
  }
  let queued = 0;
  const skippedReasons: SkippedReasons = { alreadyEnriched: 0, running: 0, error: 0, staleEmpty: 0 };
  for (const lead of leads) {
    const raw: any = lead.rawData ?? {};
    const fo: any = raw.franchiseOwner;
    const state = classifyOwnerState(fo);
    // ELEGIBILIDAD (reparación de estados históricos):
    //  - force: reencola todo.
    //  - retryErrors: solo los "error".
    //  - retryEmpty: los "done" VACÍOS (stale-empty) y los "error".
    //  - por defecto (clic explícito): nuevos + stale-empty (los "done" vacíos del fallo
    //    antiguo se reprocesan con intentos reiniciados). NUNCA reencola "done" CON datos.
    let eligible: boolean;
    if (opts.force) eligible = true;
    else if (opts.retryErrors) eligible = state === "error";
    else if (opts.retryEmpty) eligible = state === "done_empty" || state === "error";
    else eligible = state === "none" || state === "done_empty";
    if (!eligible) {
      if (state === "done_data") skippedReasons.alreadyEnriched++;
      else if (state === "queued") skippedReasons.running++;
      else if (state === "error") skippedReasons.error++;
      else if (state === "done_empty") skippedReasons.staleEmpty++;
      continue;
    }
    const brand: string | null = raw.brand ?? brandBySearch.get(lead.searchId) ?? (opts.searchId ? brandBySearch.get(opts.searchId) : null) ?? null;
    await prisma.lead.updateMany({
      where: { id: lead.id, workspaceId },
      // Reinicia intentos (attempts:0) al reencolar un stale-empty/error → reintento acotado.
      data: { rawData: { ...raw, franchiseOwner: { status: "queued", queuedAt: now.toISOString(), attempts: 0, ...(brand ? { brand } : {}) } } }
    });
    queued++;
  }
  const skipped = skippedReasons.alreadyEnriched + skippedReasons.running + skippedReasons.error + skippedReasons.staleEmpty;
  console.info(`[franchise-owner] enqueue ws=${workspaceId} search=${opts.searchId ?? "-"} scanned=${leads.length} queued=${queued} skipped=${skipped} reasons=${JSON.stringify(skippedReasons)}${opts.retryEmpty ? " (retryEmpty)" : opts.retryErrors ? " (retryErrors)" : ""}`);
  return { queued, skipped, scanned: leads.length, skippedReasons };
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
  if (leads.length > 0) console.info(`[franchise-owner] worker ws=${workspaceId} picked=${leads.length} (procesando)`);
  let processed = 0;
  let errored = 0;
  for (const lead of leads) {
    const raw: any = lead.rawData ?? {};
    const fo: any = raw.franchiseOwner ?? {};
    const attempts = Number(fo.attempts) || 0;
    try {
      const owner = await researchFranchiseOwner({
        workspaceId,
        // Marca: la guardada en el marcador (keyword de la búsqueda) > rawData.brand > nombre.
        brand: String(fo.brand ?? raw.brand ?? lead.name),
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
      console.info(`[franchise-owner] done ws=${workspaceId} lead=${lead.id} class=${owner.classification} emails=${owner.emails?.length ?? 0} conf=${owner.confidence}`);
      processed++;
    } catch (e: any) {
      // Fallo POR LEAD: reintenta hasta MAX; agotado → "error" terminal. No corta el lote.
      const nextAttempts = attempts + 1;
      const status = nextAttempts >= MAX_OWNER_ATTEMPTS ? "error" : "queued";
      const reason = String(e?.message ?? "error").slice(0, 160);
      await prisma.lead.updateMany({
        where: { id: lead.id, workspaceId },
        data: { rawData: { ...raw, franchiseOwner: { ...fo, status, attempts: nextAttempts, lastError: reason } } }
      });
      console.warn(`[franchise-owner] error ws=${workspaceId} lead=${lead.id} attempt=${nextAttempts}/${MAX_OWNER_ATTEMPTS} status=${status} reason=${reason}`);
      errored++;
    }
  }
  return { processed, errored, picked: leads.length };
}

/** DIAGNÓSTICO (autenticado, tenant-scoped): estado real de la cola para una búsqueda —
 *  cuántos leads brand_locations hay y su desglose por estado, con una muestra que incluye
 *  el motivo de error por lead. Solo lectura. Ayuda a ver por qué "no salen datos". */
export async function franchiseOwnerDiag(
  prisma: PrismaLike,
  workspaceId: string,
  searchId?: string
): Promise<{ total: number; byStatus: Record<string, number>; sample: any[] }> {
  // Ámbito: workspace + búsqueda concreta (recomendado). Sin filtro de source: cuenta TODOS los
  // leads de esa búsqueda y su estado de identificación (none si aún no se investigó).
  const scope: any = { workspaceId, ...(searchId ? { searchId } : {}) };
  const rows = await prisma.lead.findMany({ where: scope, select: { id: true, name: true, email: true, rawData: true }, take: 500 });
  // Estados que DISTINGUEN "hecho con datos" de "hecho vacío" (stale-empty del fallo antiguo).
  const byStatus: Record<string, number> = { none: 0, queued: 0, error: 0, done_data: 0, done_empty: 0 };
  const sample: any[] = [];
  for (const r of rows) {
    const fo: any = (r.rawData as any)?.franchiseOwner;
    const state = classifyOwnerState(fo);
    byStatus[state] = (byStatus[state] ?? 0) + 1;
    if (sample.length < 20) {
      sample.push({ id: r.id, name: r.name, state, classification: fo?.classification ?? null, hasEmail: !!(r.email || fo?.emails?.length), hasEvidence: ownerHasEvidence(fo), lastError: fo?.lastError ?? null });
    }
  }
  return { total: rows.length, byStatus, sample };
}

/** Progreso (para la UI): en cola / con datos / sin datos (stale-empty) / con error. Tenant-scoped.
 *  Distingue "done útil" de "done vacío" clasificando en memoria (búsquedas acotadas). */
export async function franchiseOwnerProgress(
  prisma: PrismaLike,
  workspaceId: string,
  searchId?: string
): Promise<{ queued: number; done: number; doneEmpty: number; error: number }> {
  const scope: any = { workspaceId, ...(searchId ? { searchId } : {}) };
  const rows = await prisma.lead.findMany({ where: scope, select: { rawData: true }, take: 2000 });
  const p = { queued: 0, done: 0, doneEmpty: 0, error: 0 };
  for (const r of rows) {
    switch (classifyOwnerState((r.rawData as any)?.franchiseOwner)) {
      case "queued": p.queued++; break;
      case "done_data": p.done++; break;
      case "done_empty": p.doneEmpty++; break;
      case "error": p.error++; break;
    }
  }
  return p;
}
