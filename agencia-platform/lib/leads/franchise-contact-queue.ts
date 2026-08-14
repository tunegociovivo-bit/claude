/**
 * Cola ASÍNCRONA de la FASE 2 (contacto profesional) del titular de franquicia.
 *
 * Igual patrón que la fase 1: el endpoint solo ENCOLA (marca
 * `rawData.franchiseOwner.contact.status="queued"`) y el cron procesa en lotes pequeños llamando a
 * `researchFranchiseContact` (web oficial + Hunter + Apollo). Solo se encola sobre leads cuyo
 * TITULAR ya está identificado (owner `done_data`). Aislado por lead, reintentos acotados,
 * idempotente, tenant-scoped. NO sobrescribe teléfono/email existente sin mayor confianza.
 */
import { researchFranchiseContact } from "./franchise-contact-enrichment";
import { classifyOwnerState, classifyContactState, isContactable, type ContactState } from "./franchise-owner-view";

type PrismaLike = any;
export const MAX_CONTACT_ATTEMPTS = 2;

export type ContactSkippedReasons = { notIdentified: number; alreadyContactable: number; running: number };

/**
 * Encola la búsqueda de contacto para leads de un objetivo EXPLÍCITO (búsqueda o ids), SIEMPRE del
 * workspace y SOLO si el titular está identificado. Rápido (no llama a proveedores). Idempotente.
 */
export async function queueFranchiseContactResearch(
  prisma: PrismaLike,
  workspaceId: string,
  opts: { searchId?: string; ids?: string[]; force?: boolean; retryErrors?: boolean; limit?: number; now?: Date }
): Promise<{ queued: number; skipped: number; scanned: number; skippedReasons: ContactSkippedReasons }> {
  const now = opts.now ?? new Date();
  const leads = await prisma.lead.findMany({
    where: { workspaceId, ...(opts.searchId ? { searchId: opts.searchId } : {}), ...(opts.ids?.length ? { id: { in: opts.ids } } : {}) },
    select: { id: true, rawData: true },
    take: opts.limit ?? 1000
  });
  let queued = 0;
  const skippedReasons: ContactSkippedReasons = { notIdentified: 0, alreadyContactable: 0, running: 0 };
  for (const lead of leads) {
    const raw: any = lead.rawData ?? {};
    const fo: any = raw.franchiseOwner;
    // Solo tiene sentido buscar contacto de un titular IDENTIFICADO (evidencia real).
    if (classifyOwnerState(fo) !== "done_data") { skippedReasons.notIdentified++; continue; }
    const cState = classifyContactState(fo);
    // ELEGIBILIDAD:
    //  - force: recalcula todos los identificados.
    //  - retryErrors: solo los provider_error.
    //  - por defecto: los que aún no son accionables ni están en cola.
    let eligible: boolean;
    if (opts.force) eligible = true;
    else if (opts.retryErrors) eligible = cState === "provider_error";
    else eligible = cState !== "queued" && cState !== "actionable_contact";
    if (!eligible) {
      if (cState === "actionable_contact") skippedReasons.alreadyContactable++;
      else if (cState === "queued") skippedReasons.running++;
      continue;
    }
    await prisma.lead.updateMany({
      where: { id: lead.id, workspaceId },
      // Conserva TODO el franchiseOwner (fase 1) y solo (re)inicia el sub-objeto contact.
      data: { rawData: { ...raw, franchiseOwner: { ...fo, contact: { status: "queued", queuedAt: now.toISOString(), attempts: 0 } } } }
    });
    queued++;
  }
  const skipped = skippedReasons.notIdentified + skippedReasons.alreadyContactable + skippedReasons.running;
  console.info(`[franchise-contact] enqueue ws=${workspaceId} search=${opts.searchId ?? "-"} scanned=${leads.length} queued=${queued} skipped=${skipped} reasons=${JSON.stringify(skippedReasons)}${opts.retryErrors ? " (retryErrors)" : ""}`);
  return { queued, skipped, scanned: leads.length, skippedReasons };
}

/** Procesa hasta `max` leads con la fase de contacto encolada. Aislado por lead, reintentos
 *  acotados. NO sobrescribe email/teléfono existente sin mayor confianza. */
export async function processFranchiseContactQueue(
  prisma: PrismaLike,
  workspaceId: string,
  opts: { max?: number; now?: Date } = {}
): Promise<{ processed: number; errored: number; picked: number }> {
  const now = opts.now ?? new Date();
  const leads = await prisma.lead.findMany({
    where: { workspaceId, rawData: { path: ["franchiseOwner", "contact", "status"], equals: "queued" } },
    select: { id: true, name: true, phone: true, email: true, website: true, rawData: true },
    take: opts.max ?? 2
  });
  if (leads.length > 0) console.info(`[franchise-contact] worker ws=${workspaceId} picked=${leads.length} (buscando contacto)`);
  let processed = 0;
  let errored = 0;
  for (const lead of leads) {
    const raw: any = lead.rawData ?? {};
    const fo: any = raw.franchiseOwner ?? {};
    const contact: any = fo.contact ?? {};
    const attempts = Number(contact.attempts) || 0;
    try {
      const result = await researchFranchiseContact({
        workspaceId,
        operatorName: fo.operatorName ?? null,
        taxId: fo.taxId ?? null,
        adminName: fo.ownerName ?? null,
        operatorWebsite: fo.operatorWebsite ?? null,
        existingPhone: lead.phone,
        existingEmail: lead.email,
        now
      });
      // ¿Rellenar el email del lead? Solo si NO tenía email y hay un email accionable (verificado o
      // publicado en web oficial). Nunca sobrescribe un email existente aquí.
      const actionableEmail = result.status === "actionable_contact"
        ? result.channels.find((c) => c.type === "email" && (c.source === "web_oficial" || (c.verified && ["valid", "deliverable"].includes(String(c.verified.status).toLowerCase()))))?.value
        : undefined;
      const fillEmail = !lead.email && actionableEmail ? actionableEmail : undefined;
      await prisma.lead.updateMany({
        where: { id: lead.id, workspaceId },
        data: {
          rawData: { ...raw, franchiseOwner: { ...fo, contact: { ...result, attempts, processedAt: now.toISOString() } } },
          ...(fillEmail ? { email: fillEmail } : {})
        }
      });
      console.info(`[franchise-contact] done ws=${workspaceId} lead=${lead.id} status=${result.status} channels=${result.channels.length} providers=${result.providersTried.join("+")}`);
      processed++;
    } catch (e: any) {
      const nextAttempts = attempts + 1;
      const status = nextAttempts >= MAX_CONTACT_ATTEMPTS ? "provider_error" : "queued";
      const reason = String(e?.message ?? "error").slice(0, 160);
      await prisma.lead.updateMany({
        where: { id: lead.id, workspaceId },
        data: { rawData: { ...raw, franchiseOwner: { ...fo, contact: { ...contact, status, attempts: nextAttempts, lastError: reason } } } }
      });
      console.warn(`[franchise-contact] error ws=${workspaceId} lead=${lead.id} attempt=${nextAttempts}/${MAX_CONTACT_ATTEMPTS} status=${status} reason=${reason}`);
      errored++;
    }
  }
  return { processed, errored, picked: leads.length };
}

/** Progreso de la fase de contacto para la UI. Distingue titulares identificados de contactables. */
export async function franchiseContactProgress(
  prisma: PrismaLike,
  workspaceId: string,
  searchId?: string
): Promise<{ identified: number; contactable: number; queued: number; noContact: number; error: number }> {
  const scope: any = { workspaceId, ...(searchId ? { searchId } : {}) };
  const rows = await prisma.lead.findMany({ where: scope, select: { rawData: true }, take: 2000 });
  const p = { identified: 0, contactable: 0, queued: 0, noContact: 0, error: 0 };
  for (const r of rows) {
    const fo: any = (r.rawData as any)?.franchiseOwner;
    if (classifyOwnerState(fo) !== "done_data") continue;
    p.identified++;
    const cs: ContactState = classifyContactState(fo);
    if (cs === "actionable_contact") p.contactable++;
    else if (cs === "queued") p.queued++;
    else if (cs === "identified_no_contact" || cs === "unconfirmed") p.noContact++;
    else if (cs === "provider_error") p.error++;
  }
  return p;
}

/** Diagnóstico (autenticado, tenant-scoped) de la fase de contacto por búsqueda. Solo lectura. */
export async function franchiseContactDiag(
  prisma: PrismaLike,
  workspaceId: string,
  searchId?: string
): Promise<{ total: number; byStatus: Record<string, number>; sample: any[] }> {
  const scope: any = { workspaceId, ...(searchId ? { searchId } : {}) };
  const rows = await prisma.lead.findMany({ where: scope, select: { id: true, name: true, rawData: true }, take: 500 });
  const byStatus: Record<string, number> = { none: 0, queued: 0, actionable_contact: 0, identified_no_contact: 0, unconfirmed: 0, provider_error: 0 };
  const sample: any[] = [];
  for (const r of rows) {
    const fo: any = (r.rawData as any)?.franchiseOwner;
    if (classifyOwnerState(fo) !== "done_data") continue;
    const cs = classifyContactState(fo);
    byStatus[cs] = (byStatus[cs] ?? 0) + 1;
    if (sample.length < 20) {
      const ch = Array.isArray(fo?.contact?.channels) ? fo.contact.channels : [];
      sample.push({ id: r.id, name: r.name, contactState: cs, contactable: isContactable(fo), channels: ch.length, operatorName: fo?.operatorName ?? null, lastError: fo?.contact?.lastError ?? null });
    }
  }
  return { total: rows.length, byStatus, sample };
}
