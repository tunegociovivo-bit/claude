/**
 * Search Manager: orquesta una búsqueda de leads.
 *
 * Para scope="custom": llama a Places Text Search con la provincia indicada,
 * mapea + scoring + persistencia + dedup.
 *
 * Para scope="spain": loop por las 52 provincias en bloques (`batchSize`).
 * Cada llamada al endpoint /searches/{id}/process avanza un batch.
 */

import { prisma } from "@/lib/db/prisma";
import { placesTextSearch, geocodeArea, type PlacesResult } from "./google-places";
import { buildGridPoints } from "./geo-grid";
import { phoneKind } from "./phone-type";
import { scoreLead } from "./scorer";
import { scoreTicket } from "./ticket-score";
import { SPAIN_PROVINCES, findProvince } from "./spain-provinces";
import { municipalitiesForProvince } from "./spain-municipalities";
import { expandKeyword } from "./synonyms";
import { classifyLeadsRelevance, type RelevanceVerdict } from "./relevance";
import { collectFromSource, enrichJobsResults, type LeadSourceKey } from "./sources";
import { offersToLeadResults } from "./sources/jobs";
import { fetchJobAlertOffers } from "./sources/jobs-inbox";
import { analyzeFranchiseNetwork } from "./sources/franchises";
import { startExecOutreach, draftJobsReview, saveReviewDraft } from "./exec-outreach";

/**
 * Arranca la secuencia de email automática para los leads de la fuente "jobs"
 * recién insertados en esta búsqueda que tengan email y sigan pendientes.
 * El primer email sale en el siguiente tick del cron (nextAt = ahora). El
 * cuerpo menciona la vacante concreta (se lee rawData.jobTitle al enviar).
 * Acotado por seguridad para no disparar cientos de secuencias de golpe.
 */
async function startJobsOutreach(workspaceId: string, searchId: string): Promise<number> {
  // Modo de envío del módulo Empleos. Por defecto "review" (revisar antes de
  // enviar): más seguro para validar que todo funciona al principio. El usuario
  // lo cambia a automático desde Ajustes cuando quiera.
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const reviewMode = (ws?.settings as any)?.leads?.jobsReviewMode;
  const mode: "auto" | "review" = reviewMode === false ? "auto" : "review";

  const candidates = await prisma.lead.findMany({
    where: { workspaceId, searchId, contactStatus: "pending", email: { not: null } },
    select: { id: true, email: true, name: true, category: true, rawData: true },
    take: 100
  });
  // Idempotencia: salta los leads que YA tienen secuencia/borrador (o que se
  // descartaron). Clave para la bandeja de alertas, cuya "búsqueda" se reutiliza
  // en cada pasada — sin esto se re-redactarían los ya gestionados.
  const already = await prisma.leadExecOutreach.findMany({
    where: { workspaceId, leadId: { in: candidates.map((l) => l.id) } },
    select: { leadId: true }
  });
  const handled = new Set(already.map((e) => e.leadId));
  const leads = candidates.filter((l) => !handled.has(l.id));
  let started = 0;

  // Modo AUTOMÁTICO: arranca la secuencia; el primer email sale en el cron.
  if (mode === "auto") {
    for (const l of leads) {
      try {
        await startExecOutreach({ workspaceId, leadId: l.id, email: l.email, mode });
        started++;
      } catch (err) {
        console.error("[search-manager jobs] startExecOutreach error:", err);
      }
    }
    return started;
  }

  // Modo REVISIÓN: redacta YA el email de cada empresa y déjalo en la cola de
  // revisión, para que el usuario lo vea al terminar la búsqueda (sin esperar al
  // cron). En tandas de 5 para no disparar la latencia con muchas empresas.
  const CHUNK = 5;
  for (let i = 0; i < leads.length; i += CHUNK) {
    const slice = leads.slice(i, i + CHUNK);
    const done = await Promise.all(
      slice.map(async (l) => {
        const rd: any = l.rawData ?? {};
        const jobTitle = typeof rd?.jobTitle === "string" ? rd.jobTitle : null;
        const jobDescription = typeof rd?.jobDescription === "string" ? rd.jobDescription : null;
        const director = typeof rd?.directorName === "string" ? rd.directorName : null;
        try {
          await draftJobsReview({ workspaceId, leadId: l.id, email: l.email as string, company: l.name, sector: l.category, jobTitle, jobDescription, director });
          return true;
        } catch (err) {
          console.error("[search-manager jobs] draftJobsReview error:", err);
          return false;
        }
      })
    );
    started += done.filter(Boolean).length;
  }
  return started;
}

/**
 * Ingesta de la BANDEJA DE ALERTAS de empleo (IMAP): lee los emails de alerta
 * nuevos, extrae las ofertas, las convierte en leads (marketing/IA), enriquece
 * contacto y arranca la revisión de emails — todo SIN gastar créditos de scraping.
 * Idempotente: los emails se marcan leídos y los leads se deduplican por empresa.
 */
export async function ingestJobsInbox(
  workspaceId: string
): Promise<{ emails: number; offers: number; ingested: number; error?: string }> {
  const { offers, emails, error } = await fetchJobAlertOffers(workspaceId);
  if (error && offers.length === 0) return { emails, offers: 0, ingested: 0, error };

  // Ofertas → leads (filtra puestos de marketing/IA + dedup por empresa) y
  // enriquece teléfono/web/email (Places + web), igual que el scraper.
  const mapped = offersToLeadResults(offers);
  if (mapped.length === 0) return { emails, offers: offers.length, ingested: 0, error };
  const enriched = await enrichJobsResults(workspaceId, mapped);

  // Contenedor de búsqueda persistente para los leads de la bandeja.
  let search = await prisma.leadSearch.findFirst({
    where: { workspaceId, source: "jobs", location: "Bandeja de alertas" } as any
  });
  if (!search) {
    search = await prisma.leadSearch.create({
      data: {
        workspaceId,
        keyword: "Alertas de empleo",
        location: "Bandeja de alertas",
        scope: "custom",
        source: "jobs",
        totalProvinces: 1,
        processedProvinces: 1,
        status: "COMPLETED",
        sourceConfig: { inbox: true }
      } as any
    });
  }

  const multiSet = await computeMultiLocationSet(workspaceId, enriched);
  let ingested = 0;
  let position = 1;
  for (const r of enriched) {
    try {
      const out = await upsertLead({
        workspaceId,
        searchId: search.id,
        province: r.province ?? "España",
        position: position++,
        r,
        aiRelevance: null,
        skipExisting: false,
        multiLocation: multiSet.has((r.name ?? "").trim())
      });
      if (!out?.skipped) ingested++;
    } catch (err) {
      console.error("[jobs-inbox] upsert lead error:", err);
    }
  }

  // Redacta/arranca el outreach de revisión para los nuevos leads con email.
  try {
    await startJobsOutreach(workspaceId, search.id);
  } catch (err) {
    console.error("[jobs-inbox] startJobsOutreach error:", err);
  }

  // Sella la última ejecución (para mostrarla en Ajustes).
  try {
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
    const settings: any = ws?.settings ?? {};
    settings.leads = settings.leads ?? {};
    settings.leads.jobsInboxLastRun = new Date().toISOString();
    await prisma.workspace.update({ where: { id: workspaceId }, data: { settings } });
  } catch {}

  return { emails, offers: offers.length, ingested, error };
}

/**
 * Re-enriquece los leads de la fuente jobs que se quedaron SIN email: vuelve a
 * buscar web+teléfono (Places) y email (web, con el extractor mejorado). A las
 * que ahora sí tienen email, les redacta el borrador de revisión. Para recuperar
 * empresas detectadas en pasadas anteriores cuando aún no dábamos con su email.
 */
export async function reEnrichJobsLeads(workspaceId: string): Promise<{ scanned: number; emailsFound: number; drafted: number }> {
  const leads = await prisma.lead.findMany({
    where: { workspaceId, email: null, contactStatus: "pending", rawData: { path: ["source"], equals: "jobs" } } as any,
    take: 50,
    select: { id: true, name: true, province: true, website: true, phone: true, internationalPhone: true, category: true, rawData: true }
  });
  if (leads.length === 0) return { scanned: 0, emailsFound: 0, drafted: 0 };

  const pr: PlacesResult[] = leads.map((l) => ({
    placeId: `jobs:reenrich:${l.id}`,
    name: l.name,
    formattedAddress: null,
    province: l.province,
    types: ["jobs.listing"],
    category: l.category,
    latitude: null,
    longitude: null,
    rating: null,
    userRatingCount: 0,
    priceLevel: null,
    businessStatus: "OPERATIONAL",
    gmbUrl: null,
    website: l.website,
    phone: l.phone,
    internationalPhone: l.internationalPhone,
    rawData: { ...((l.rawData as any) ?? {}) }
  }));
  const enriched = await enrichJobsResults(workspaceId, pr);

  let emailsFound = 0;
  const nowEmailed: { id: string; email: string; name: string; category: string | null; rawData: any }[] = [];
  for (let i = 0; i < leads.length; i++) {
    const e = enriched[i];
    const rd: any = e?.rawData ?? {};
    const email = typeof rd.email === "string" ? rd.email : null;
    const data: any = {};
    if (email) { data.email = email; emailsFound++; }
    if (!leads[i].website && e?.website) data.website = e.website;
    if (!leads[i].phone && e?.phone) { data.phone = e.phone; data.internationalPhone = e.internationalPhone; }
    // Persiste el rawData enriquecido (incluye directorName/role/via de Apollo/
    // Hunter) para que el saludo por nombre sobreviva a "Regenerar".
    if (email && typeof rd.directorName === "string") data.rawData = rd;
    if (Object.keys(data).length) await prisma.lead.update({ where: { id: leads[i].id }, data }).catch(() => {});
    if (email) nowEmailed.push({ id: leads[i].id, email, name: leads[i].name, category: leads[i].category, rawData: rd });
  }

  // Redacta el borrador de revisión para las que ahora tienen email y aún no
  // tienen secuencia (respeta lo ya gestionado/descartado).
  let drafted = 0;
  if (nowEmailed.length > 0) {
    const already = await prisma.leadExecOutreach.findMany({
      where: { workspaceId, leadId: { in: nowEmailed.map((l) => l.id) } },
      select: { leadId: true }
    });
    const handled = new Set(already.map((e) => e.leadId));
    for (const l of nowEmailed.filter((x) => !handled.has(x.id))) {
      const jobTitle = typeof l.rawData?.jobTitle === "string" ? l.rawData.jobTitle : null;
      const jobDescription = typeof l.rawData?.jobDescription === "string" ? l.rawData.jobDescription : null;
      const director = typeof l.rawData?.directorName === "string" ? l.rawData.directorName : null;
      try {
        await draftJobsReview({ workspaceId, leadId: l.id, email: l.email, company: l.name, sector: l.category, jobTitle, jobDescription, director });
        drafted++;
      } catch (err) {
        console.error("[jobs-reenrich] draftJobsReview error:", err);
      }
    }
  }
  return { scanned: leads.length, emailsFound, drafted };
}

/**
 * Analiza las franquicias seleccionadas: por cada marca, muestrea su red en
 * Google, genera el informe de salud + el email a la central, crea el lead
 * (la central) y deja el email en la cola de revisión. Devuelve un resumen por
 * marca para la UI. Reutiliza upsertLead + la cola de revisión existentes.
 */
export async function analyzeFranchises(
  workspaceId: string,
  brands: string[],
  location?: string
): Promise<{ results: { brand: string; sampled: number; metrics: any | null; emailed: boolean; email: string | null; contact?: any; status?: string; contactedAt?: string | null; error?: string }[] }> {
  // Contenedor de búsqueda persistente para los leads de franquicias.
  let search = await prisma.leadSearch.findFirst({
    where: { workspaceId, source: "franchises", location: "Franquicias" } as any
  });
  if (!search) {
    search = await prisma.leadSearch.create({
      data: {
        workspaceId,
        keyword: "Franquicias (central)",
        location: "Franquicias",
        scope: "custom",
        source: "franchises",
        totalProvinces: 1,
        processedProvinces: 1,
        status: "COMPLETED",
        sourceConfig: { franchises: true }
      } as any
    });
  }

  const results: { brand: string; sampled: number; metrics: any | null; emailed: boolean; email: string | null; contact?: any; status?: string; contactedAt?: string | null; error?: string }[] = [];
  let position = 1;
  for (const brand of brands.slice(0, 12)) {
    try {
      const a = await analyzeFranchiseNetwork(workspaceId, brand, location);
      if (!a) {
        results.push({ brand, sampled: 0, metrics: null, emailed: false, email: null, status: "no_network", error: "No se encontró red suficiente en Google (mín. 3 fichas)." });
        continue;
      }
      await upsertLead({
        workspaceId,
        searchId: search.id,
        province: a.central.province ?? "España",
        position: position++,
        r: a.central,
        aiRelevance: null,
        skipExisting: false
      });
      const lead = await prisma.lead.findUnique({
        where: { workspaceId_placeId: { workspaceId, placeId: a.central.placeId } },
        select: { id: true, contactStatus: true }
      });
      let emailed = false;
      // Estado claro para NO insistir: ya contactada (email enviado) / borrador en
      // cola (aún no enviado) / borrador creado ahora / sin email.
      let status = "no_email";
      let contactedAt: string | null = null;
      if (lead) {
        const already = await prisma.leadExecOutreach.findFirst({
          where: { workspaceId, leadId: lead.id },
          select: { status: true, updatedAt: true }
        });
        const isSent = ["contacted", "responded", "client"].includes(lead.contactStatus) || (already && already.status !== "pending_review");
        if (isSent) {
          status = "contacted";
          contactedAt = already?.updatedAt ? already.updatedAt.toISOString() : null;
        } else if (already) {
          status = "draft_pending"; // ya tiene borrador esperando aprobación
        } else if (a.email && a.subject && a.body) {
          await saveReviewDraft(workspaceId, lead.id, a.email, a.subject, a.body);
          emailed = true;
          status = "drafted_now";
        }
      }
      results.push({ brand, sampled: a.metrics.sampled, metrics: a.metrics, emailed, email: a.email, contact: a.contact, status, contactedAt });
    } catch (err: any) {
      results.push({ brand, sampled: 0, metrics: null, emailed: false, email: null, status: "error", error: String(err?.message ?? err).slice(0, 160) });
    }
  }
  return { results };
}

/**
 * Importa franquicias desde los DIRECTORIOS (portales de franquicias): scrapea las
 * fichas, saca el contacto de expansión/marketing (con email deducido por Hunter si
 * falta) y las guarda como leads de central con CONTACTO VERIFICADO. Devuelve la
 * lista para mostrarla — "trabajar con emails que funcionan".
 */
export async function importFranchiseDirectory(
  workspaceId: string
): Promise<{ imported: number; withEmail: number; scanned: number; contacts: any[]; perDirectory: any[] }> {
  const { crawlFranchiseDirectories } = await import("./sources/franchise-directory");
  const { contacts, scanned, perDirectory } = await crawlFranchiseDirectories(workspaceId, { max: 60 });

  const search = await getOrCreateFranchiseSearch(workspaceId);
  const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  let imported = 0;
  let withEmail = 0;
  let position = 1;
  for (const c of contacts) {
    const key = slugify(c.brand);
    if (!key) continue;
    const central: PlacesResult = {
      placeId: `franchise:${key}`,
      name: c.brand,
      formattedAddress: null,
      province: "España",
      types: ["franchise.central"],
      category: "Central de franquicia",
      latitude: null,
      longitude: null,
      rating: null,
      userRatingCount: 0,
      priceLevel: null,
      businessStatus: "OPERATIONAL",
      gmbUrl: null,
      website: c.corporateWeb,
      phone: c.phone,
      internationalPhone: null,
      rawData: {
        source: "franchises",
        contactSource: "directory",
        directory: c.directory,
        directoryUrl: c.sourceUrl,
        brand: c.brand,
        sector: c.sector ?? undefined,
        email: c.email ?? undefined,
        // Otros emails de la ficha → copia oculta.
        bccEmails: Array.isArray(c.emails) && c.emails.length > 1
          ? c.emails.filter((e: string) => e.toLowerCase() !== (c.email ?? "").toLowerCase())
          : undefined,
        directorName: c.contactName ?? undefined,
        directorRole: c.role ?? undefined,
        contactVerified: !!c.email
      }
    };
    try {
      await upsertLead({ workspaceId, searchId: search.id, province: "España", position: position++, r: central, aiRelevance: null, skipExisting: false });
      imported++;
      if (c.email) withEmail++;
    } catch (err) {
      console.error("[franchise-directory] upsert error:", err);
    }
  }
  return { imported, withEmail, scanned, contacts, perDirectory };
}

/** Contenedor de búsqueda persistente para los leads de franquicias. */
async function getOrCreateFranchiseSearch(workspaceId: string) {
  let search = await prisma.leadSearch.findFirst({ where: { workspaceId, source: "franchises", location: "Franquicias" } as any });
  if (!search) {
    search = await prisma.leadSearch.create({
      data: {
        workspaceId,
        keyword: "Franquicias (central)",
        location: "Franquicias",
        scope: "custom",
        source: "franchises",
        totalProvinces: 1,
        processedProvinces: 1,
        status: "COMPLETED",
        sourceConfig: { franchises: true }
      } as any
    });
  }
  return search;
}

/** Clave de caché de barridos: normaliza keyword/área (minúsculas, espacios). */
function normKey(s: string): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export async function startSearch(opts: {
  workspaceId: string;
  userId?: string | null;
  keyword: string;
  location: string;
  /** Municipio concreto: si llega, búsqueda a fondo solo en él. */
  municipality?: string;
  scope: "custom" | "spain";
  source?: LeadSourceKey; // default "places"
  /** Si true, leads con placeId ya presente en otras búsquedas del workspace
   *  se saltan (búsqueda incremental + dedup cross-búsqueda). */
  skipExisting?: boolean;
  /** Filtros específicos por fuente. Para "places":
   *    { lowRatingOnly?: boolean, maxRating?: number, minReviewsCount?: number } */
  sourceConfig?: Record<string, any>;
}): Promise<{ searchId: string; totalProvinces: number }> {
  const source: LeadSourceKey = opts.source ?? "places";
  const location = opts.location.trim();
  const municipality = opts.municipality?.trim() || "";
  const province = findProvince(location); // location es una provincia conocida?

  // Config de troceado (se guarda en sourceConfig para no migrar el schema):
  //   - municipality → busca a fondo solo ese municipio (1 "target").
  //   - tileMunicipalities → itera TODOS los municipios de la provincia
  //     (modo "máximo volumen"): cada municipio es un target del batch.
  const tiling: Record<string, any> = {};
  let totalTargets = 1;
  // Búsqueda por CUADRÍCULA (opt-in): divide el área en una rejilla de celdas
  // lat/lng y consulta cada una, superando el tope de ~60 de Google en zonas
  // densas. Tiene prioridad sobre el troceado por municipios.
  const useGrid = !!opts.sourceConfig?.useGrid;
  if (source === "places" && useGrid && opts.scope === "custom") {
    // Centro de la rejilla: el municipio si se indicó, si no la provincia.
    const areaForCenter = municipality
      ? `${municipality}, ${province?.name ?? location}`
      : province?.name ?? location;
    let center: { lat: number; lng: number } | null = null;
    try {
      center = await geocodeArea({ workspaceId: opts.workspaceId, area: areaForCenter });
    } catch {
      center = null;
    }
    if (!center && province?.lat != null && province?.lng != null) {
      center = { lat: province.lat, lng: province.lng };
    }
    if (center) {
      // Municipio → rejilla densa de ciudad (~12 km de medio lado).
      // Provincia → rejilla más amplia (~28 km) para cubrir el área metropolitana.
      const halfSpanKm = municipality ? 12 : 28;
      const stepKm = municipality ? 3.5 : 8;
      const { cells, cellRadiusMeters } = buildGridPoints({
        lat: center.lat,
        lng: center.lng,
        halfSpanKm,
        stepKm,
        maxCells: 64
      });
      tiling.gridCells = cells;
      tiling.gridRadiusMeters = cellRadiusMeters;
      tiling.tileProvince = province?.name ?? location;
      totalTargets = cells.length;
    }
  }
  if (source === "places" && totalTargets === 1 && !tiling.gridCells) {
    if (opts.scope === "spain") {
      if (useGrid) {
        // Máxima cobertura nacional: trocear por TODOS los municipios de cada
        // provincia (no solo la capital), igual que el modo provincia pero a
        // nivel país. Cubre todo el territorio, no solo las grandes ciudades.
        let n = 0;
        for (const p of SPAIN_PROVINCES) n += municipalitiesForProvince(p.name).length;
        totalTargets = n || SPAIN_PROVINCES.length;
        tiling.spainMunicipalities = true;
      } else {
        totalTargets = SPAIN_PROVINCES.length;
      }
    } else if (municipality) {
      tiling.municipality = municipality;
      tiling.tileProvince = province?.name ?? location;
      totalTargets = 1;
    } else if (province) {
      const munis = municipalitiesForProvince(province.name);
      if (munis.length > 0) {
        tiling.tileMunicipalities = true;
        tiling.tileProvince = province.name;
        totalTargets = munis.length;
      }
    }
  }

  const search = await prisma.leadSearch.create({
    data: {
      workspaceId: opts.workspaceId,
      keyword: opts.keyword.trim(),
      location:
        (municipality ? `${municipality} (${tiling.tileProvince})` : location) ||
        (opts.scope === "spain" ? "Toda España" : ""),
      scope: opts.scope,
      source,
      totalProvinces: totalTargets,
      processedProvinces: 0,
      status: "PENDING",
      skipExisting: !!opts.skipExisting,
      sourceConfig: { ...(opts.sourceConfig ?? {}), ...tiling }
    } as any
  });
  return { searchId: search.id, totalProvinces: totalTargets };
}

/**
 * Procesa un batch de provincias para la búsqueda dada. Devuelve cuántas
 * provincias quedan por procesar.
 */
export async function processSearchBatch(opts: {
  workspaceId: string;
  searchId: string;
  batchSize?: number;
}): Promise<{ processed: number; pending: number; status: string; leadsInserted: number; leadsSkipped: number }> {
  const search = await prisma.leadSearch.findFirst({
    where: { id: opts.searchId, workspaceId: opts.workspaceId }
  });
  if (!search) throw new Error("Búsqueda no encontrada");
  if (["COMPLETED", "FAILED"].includes(search.status)) {
    return { processed: search.processedProvinces, pending: 0, status: search.status, leadsInserted: 0, leadsSkipped: 0 };
  }

  await prisma.leadSearch.update({
    where: { id: search.id },
    data: { status: "RUNNING", startedAt: search.startedAt ?? new Date() }
  });

  // ──────────────────────────────────────────────────────────────────
  // Dispatcher por fuente. "places" mantiene el flujo histórico (loop
  // por provincias con google-places). El resto de fuentes (borme,
  // trustpilot…) se procesan en UN solo batch via collectFromSource.
  // ──────────────────────────────────────────────────────────────────
  if ((search as any).source && (search as any).source !== "places") {
    return processNonPlacesBatch({ workspaceId: opts.workspaceId, search });
  }

  // Cada "target" es un área de búsqueda: nombre para el textQuery de Places,
  // provincia para etiquetar el lead, y coords opcionales para el locationBias.
  type Target = {
    area: string;
    provinceTag: string;
    lat?: number;
    lng?: number;
    radiusMeters?: number;
    gridMode?: boolean;
  };
  const cfg: any = (search as any).sourceConfig ?? {};
  const batchSize = opts.batchSize ?? 5;
  const from = search.processedProvinces;
  let targets: Target[];
  if (Array.isArray(cfg.gridCells) && cfg.gridCells.length > 0) {
    // Búsqueda por cuadrícula: cada celda es un punto lat/lng con radio. El
    // textQuery va sin nombre de zona (puro geo, locationBias). El dedup entre
    // celdas lo hace el upsert por workspaceId+placeId.
    const prov = cfg.tileProvince ?? search.location;
    targets = cfg.gridCells.slice(from, from + batchSize).map((c: any, i: number) => ({
      area: `${prov} · celda ${from + i + 1}/${cfg.gridCells.length}`,
      provinceTag: prov,
      lat: c.lat,
      lng: c.lng,
      radiusMeters: cfg.gridRadiusMeters ?? 3000,
      gridMode: true
    }));
  } else if (search.scope === "spain" && cfg.spainMunicipalities) {
    // Máxima cobertura nacional: lista plana de TODOS los municipios de todas
    // las provincias (en el mismo orden con que se contaron en startSearch) y
    // se trocea por batch. Bias a la capital de provincia; el nombre del
    // municipio en el textQuery hace que Google lo geolocalice.
    const flat: Target[] = [];
    for (const p of SPAIN_PROVINCES) {
      for (const m of municipalitiesForProvince(p.name)) {
        flat.push({ area: `${m}, ${p.name}`, provinceTag: p.name, lat: p.lat, lng: p.lng });
      }
    }
    targets = flat.slice(from, from + batchSize);
  } else if (search.scope === "spain") {
    targets = SPAIN_PROVINCES.slice(from, from + batchSize).map((p) => ({
      area: p.name,
      provinceTag: p.name,
      lat: p.lat,
      lng: p.lng
    }));
  } else if (cfg.municipality) {
    // Municipio concreto → búsqueda a fondo solo ahí (1 target).
    const prov = findProvince(cfg.tileProvince ?? search.location);
    targets = [
      {
        area: `${cfg.municipality}, ${cfg.tileProvince ?? search.location}`,
        provinceTag: cfg.tileProvince ?? search.location,
        lat: prov?.lat,
        lng: prov?.lng
      }
    ];
  } else if (cfg.tileMunicipalities && cfg.tileProvince) {
    // Máximo volumen → un target por municipio de la provincia.
    const prov = findProvince(cfg.tileProvince);
    const munis = municipalitiesForProvince(cfg.tileProvince);
    targets = munis.slice(from, from + batchSize).map((m) => ({
      area: `${m}, ${cfg.tileProvince}`,
      provinceTag: cfg.tileProvince,
      lat: prov?.lat,
      lng: prov?.lng
    }));
  } else {
    // Texto libre (no es una provincia reconocida): una sola consulta.
    const prov = findProvince(search.location);
    targets = prov
      ? [{ area: prov.name, provinceTag: prov.name, lat: prov.lat, lng: prov.lng }]
      : [{ area: search.location, provinceTag: search.location }];
  }

  let leadsInserted = 0;
  let leadsSkipped = 0;
  // #4 Caché de barridos: si cacheDays>0, saltamos consultas a Google de áreas
  // vistas hace menos de X días (ahorro de API al rebuscar a menudo).
  const cacheDays = Number(cfg.cacheDays) > 0 ? Number(cfg.cacheDays) : 0;
  const cacheCutoff = cacheDays > 0 ? new Date(Date.now() - cacheDays * 86400000) : null;
  // #2/#3 Búsqueda troceada (país/provincia por municipios) → menos páginas por
  // consulta (los municipios pequeños rara vez superan 1 página de todos modos).
  const tiled = search.scope === "spain" || !!cfg.tileMunicipalities || !!cfg.spainMunicipalities;
  // Si Places lanza error en alguna provincia, guardamos el último para
  // surfacearlo en la UI si la búsqueda acaba con 0 leads.
  let batchError: string | null = null;
  for (const prov of targets) {
    try {
      await prisma.leadSearch.update({
        where: { id: search.id },
        data: { currentProvince: prov.area }
      });
      // #4 ¿Área barrida recientemente? → no gastamos consulta a Google.
      const cacheable = !!cacheCutoff && !prov.gridMode && !!prov.area;
      const cacheKey = cacheable ? `${normKey(search.keyword)}|${normKey(prov.area)}` : "";
      if (cacheable) {
        const hit = await prisma.leadQueryCache.findUnique({
          where: { workspaceId_cacheKey: { workspaceId: opts.workspaceId, cacheKey } },
          select: { lastQueriedAt: true }
        });
        if (hit && hit.lastQueriedAt > cacheCutoff!) continue;
      }
      // Sinónimos del nicho (opt-in): lanzamos una consulta por variante y
      // fusionamos deduplicando por placeId, para cubrir fichas que aparecen
      // bajo otra denominación ("dentista" vs "clínica dental").
      const variants = (search as any).sourceConfig?.useSynonyms
        ? expandKeyword(search.keyword, 3)
        : [search.keyword];
      let results: PlacesResult[] = [];
      const seenPlace = new Set<string>();
      for (const kw of variants) {
        const part = await placesTextSearch({
          workspaceId: opts.workspaceId,
          // En modo cuadrícula la consulta es puro geo (keyword + locationBias a
          // la celda); en el resto incluimos el nombre del área en el texto.
          query: prov.gridMode ? kw.trim() : `${kw} en ${prov.area}`.trim(),
          lat: prov.lat || undefined,
          lng: prov.lng || undefined,
          radiusMeters: prov.radiusMeters,
          // #2/#3 menos páginas en barridos masivos (grid o troceado por municipios).
          maxPages: prov.gridMode ? 2 : tiled ? 2 : undefined,
          province: prov.provinceTag
        });
        for (const r of part) {
          if (r.placeId && seenPlace.has(r.placeId)) continue;
          if (r.placeId) seenPlace.add(r.placeId);
          results.push(r);
        }
      }
      // Filtro de "reseñas bajas" (mejora propuesta — leads urgentes con
      // problema reputacional, encaje perfecto con el pitch GMB). Activado
      // desde NewSearchModal con el checkbox "Solo negocios con reseñas
      // bajas". Se persiste en LeadSearch.sourceConfig.lowRatingOnly.
      const cfg: any = (search as any).sourceConfig ?? {};
      if (cfg.lowRatingOnly) {
        const maxRating = typeof cfg.maxRating === "number" ? cfg.maxRating : 3.5;
        const minReviews = typeof cfg.minReviewsCount === "number" ? cfg.minReviewsCount : 5;
        results = results.filter(
          (r) =>
            r.rating != null &&
            r.rating <= maxRating &&
            (r.userRatingCount ?? 0) >= minReviews
        );
      }
      // Filtro "WhatsApp real": solo negocios con MÓVIL (6/7). Descarta fijos
      // (que casi nunca tienen WhatsApp) y fichas sin teléfono → menos cola
      // muerta y mejor tasa de entrega del canal.
      if (cfg.mobileOnly) {
        results = results.filter((r) => phoneKind(r.phone, r.internationalPhone) === "mobile");
      }
      // Clasificación IA de relevancia: descarta resultados que NO encajan
      // con el nicho real del keyword (p. ej. masajes terapéuticos cuando
      // se buscaba "masajes eróticos"). Los descartados se guardan igual,
      // pero con contactStatus="excluded" para que NO se encolen mensajes.
      const valid = results.filter((r) => !!r.placeId);
      const verdicts = await classifyLeadsRelevance({
        workspaceId: opts.workspaceId,
        keyword: search.keyword,
        location: prov.provinceTag,
        leads: valid.map((r) => ({
          placeId: r.placeId!,
          name: r.name,
          category: r.category,
          types: r.types,
          formattedAddress: r.formattedAddress,
          website: r.website
        }))
      });
      const multiSet = await computeMultiLocationSet(opts.workspaceId, results);
      let position = 1;
      for (const r of results) {
        try {
          const v = r.placeId ? verdicts.get(r.placeId) : null;
          const upsertOut = await upsertLead({
            workspaceId: opts.workspaceId,
            searchId: search.id,
            province: prov.provinceTag,
            position: position++,
            r,
            aiRelevance: v ?? null,
            skipExisting: search.skipExisting,
            multiLocation: multiSet.has((r.name ?? "").trim())
          });
          if (upsertOut?.skipped) leadsSkipped++;
          else leadsInserted++;
        } catch (err) {
          console.error("[search-manager] upsert lead error:", err);
        }
      }
      // #4 marca el área como barrida ahora (para futuras re-búsquedas con caché).
      if (cacheable) {
        await prisma.leadQueryCache
          .upsert({
            where: { workspaceId_cacheKey: { workspaceId: opts.workspaceId, cacheKey } },
            create: { workspaceId: opts.workspaceId, cacheKey, lastQueriedAt: new Date() },
            update: { lastQueriedAt: new Date() }
          })
          .catch(() => {});
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error(`[search-manager] área ${prov.area} fallo:`, msg);
      // Recordamos el último error para mostrarlo en la UI si el batch
      // acaba sin haber insertado ningún lead. Sin esto, el usuario veía
      // "COMPLETED · 0 leads" sin pista de por qué (caso típico: API key
      // de Google Places caducada, billing desactivado, Places API sin
      // habilitar). Ahora aparece el mensaje literal de Google.
      batchError = msg.slice(0, 600);
    }
  }

  const newProcessed = Math.min(search.processedProvinces + targets.length, search.totalProvinces);
  const pending = search.totalProvinces - newProcessed;
  // Si terminamos toda la búsqueda sin ningún lead y SÍ hubo error de
  // Places en algún momento, marcamos FAILED con el mensaje. Si hubo
  // leads, lo dejamos en COMPLETED aunque alguna provincia fallara
  // puntualmente (resultado parcial sigue siendo útil).
  const totalAfter = search.totalResults + leadsInserted;
  let newStatus: string;
  let errorToPersist: string | null = null;
  if (pending === 0) {
    if (totalAfter === 0 && batchError) {
      newStatus = "FAILED";
      errorToPersist = batchError;
    } else {
      newStatus = "COMPLETED";
    }
  } else {
    newStatus = "RUNNING";
  }

  await prisma.leadSearch.update({
    where: { id: search.id },
    data: {
      processedProvinces: newProcessed,
      totalResults: totalAfter,
      status: newStatus,
      errorMessage: errorToPersist ?? (newStatus === "COMPLETED" ? null : undefined),
      currentProvince: pending === 0 ? null : search.currentProvince,
      completedAt: pending === 0 ? new Date() : null,
      leadsSkipped: { increment: leadsSkipped }
    }
  });

  return { processed: newProcessed, pending, status: newStatus, leadsInserted, leadsSkipped };
}

/**
 * Procesa una búsqueda cuya fuente NO es Google Places. Llama al collector
 * de la fuente (borme / trustpilot / etc.), pasa los resultados por el
 * clasificador IA de relevancia, hace upsertLead y marca la búsqueda como
 * COMPLETED. Se ejecuta en un solo batch — no hay "provincias" que iterar.
 */
async function processNonPlacesBatch(opts: {
  workspaceId: string;
  search: any;
}): Promise<{ processed: number; pending: number; status: string; leadsInserted: number; leadsSkipped: number }> {
  const search = opts.search;
  const source = (search.source ?? "borme") as LeadSourceKey;

  let results: PlacesResult[] = [];
  let errorMessage: string | null = null;
  try {
    results = await collectFromSource(source, {
      workspaceId: opts.workspaceId,
      keyword: search.keyword,
      location: search.location,
      scope: search.scope as "custom" | "spain"
    });
  } catch (e: any) {
    errorMessage = String(e?.message ?? e).slice(0, 600);
  }

  let leadsInserted = 0;
  let leadsSkipped = 0;

  if (!errorMessage && results.length > 0) {
    // IA: filtra por relevancia respecto al keyword (útil sobre todo en
    // BORME — el sumario trae TODAS las constituciones del día, no solo
    // las del nicho del usuario).
    const valid = results.filter((r) => !!r.placeId);
    // En BDNS el keyword es un importe mínimo (no un nicho), así que el filtro
    // de relevancia IA no aplica: marcaría todo como irrelevante. Lo saltamos.
    // jobs: el "lead" es la EMPRESA que contrata, no el puesto; el keyword ya
    // filtró por marketing/IA en el propio portal. Clasificar la empresa por el
    // keyword marcaría todo como irrelevante, así que lo saltamos (como bdns).
    const skipRelevance = source === "bdns" || source === "jobs" || !/[a-záéíóúñ]/i.test(search.keyword ?? "");
    const verdicts = skipRelevance
      ? new Map<string, RelevanceVerdict>()
      : await classifyLeadsRelevance({
          workspaceId: opts.workspaceId,
          keyword: search.keyword,
          location: search.location || "España",
          leads: valid.map((r) => ({
            placeId: r.placeId!,
            name: r.name,
            category: r.category,
            types: r.types,
            formattedAddress: r.formattedAddress,
            website: r.website
          }))
        });

    const multiSet = await computeMultiLocationSet(opts.workspaceId, results);
    let position = 1;
    for (const r of results) {
      try {
        const v = r.placeId ? verdicts.get(r.placeId) : null;
        const upsertOut = await upsertLead({
          workspaceId: opts.workspaceId,
          searchId: search.id,
          province: r.province ?? "España",
          position: position++,
          r,
          aiRelevance: v ?? null,
          skipExisting: search.skipExisting,
          multiLocation: multiSet.has((r.name ?? "").trim())
        });
        if (upsertOut?.skipped) leadsSkipped++;
        else leadsInserted++;
      } catch (err) {
        console.error(`[search-manager ${source}] upsert lead error:`, err);
      }
    }

    // jobs: envío automático. Arranca la secuencia de email a las empresas con
    // oferta abierta de marketing/IA cuyo email hemos podido extraer.
    if (source === "jobs" && leadsInserted > 0) {
      try {
        const started = await startJobsOutreach(opts.workspaceId, search.id);
        console.log(`[search-manager jobs] outreach iniciado para ${started} empresa(s)`);
      } catch (err) {
        console.error("[search-manager jobs] startJobsOutreach error:", err);
      }
    }
  }

  const newStatus = errorMessage && leadsInserted === 0 ? "FAILED" : "COMPLETED";
  await prisma.leadSearch.update({
    where: { id: search.id },
    data: {
      processedProvinces: 1,
      totalProvinces: 1,
      totalResults: search.totalResults + leadsInserted,
      status: newStatus,
      errorMessage: errorMessage ?? null,
      currentProvince: null,
      completedAt: new Date(),
      leadsSkipped: { increment: leadsSkipped }
    }
  });

  return {
    processed: 1,
    pending: 0,
    status: newStatus,
    leadsInserted,
    leadsSkipped
  };
}

/**
 * Detecta CADENAS / multi-local: negocios cuyo mismo nombre aparece en varias
 * fichas (en este batch o ya en la BD del workspace) → más presupuesto, decisión
 * centralizada = mejor ticket. Una sola query agrupada, sin N+1.
 */
async function computeMultiLocationSet(workspaceId: string, results: PlacesResult[]): Promise<Set<string>> {
  const multi = new Set<string>();
  const freq = new Map<string, number>();
  for (const r of results) {
    const n = (r.name ?? "").trim();
    if (!n) continue;
    const c = (freq.get(n) ?? 0) + 1;
    freq.set(n, c);
    if (c >= 2) multi.add(n);
  }
  const names = Array.from(freq.keys());
  if (names.length === 0) return multi;
  const batchPlaceIds = results.map((r) => r.placeId).filter(Boolean) as string[];
  try {
    const grouped = await prisma.lead.groupBy({
      by: ["name"],
      // Excluimos los placeId de este batch: así solo contamos OTRAS fichas con
      // el mismo nombre (no el mismo negocio re-encontrado en una re-búsqueda).
      where: { workspaceId, name: { in: names }, placeId: { notIn: batchPlaceIds } },
      _count: { name: true }
    });
    for (const g of grouped) {
      // Existe otra ficha distinta con el mismo nombre → cadena multi-local.
      if ((g._count?.name ?? 0) >= 1) multi.add(g.name);
    }
  } catch {
    // Best-effort: si la query falla, nos quedamos con la detección por batch.
  }
  return multi;
}

async function upsertLead(opts: {
  workspaceId: string;
  searchId: string;
  province: string;
  position: number;
  r: PlacesResult;
  aiRelevance: RelevanceVerdict | null;
  skipExisting?: boolean;
  multiLocation?: boolean;
}): Promise<{ skipped: boolean } | undefined> {
  const { r } = opts;
  if (!r.placeId) return;

  // Búsqueda incremental: si el lead ya existe en OTRA búsqueda del workspace,
  // lo saltamos en silencio. Esto cubre dos casos:
  //   #7 rebuscar el mismo keyword sin reescribir lo ya recolectado;
  //   #13 keyword distinto que solapa (peluquería vs salón de belleza) →
  //        evita contactar dos veces a la misma ficha.
  if (opts.skipExisting) {
    const existingOther = await prisma.lead.findUnique({
      where: { workspaceId_placeId: { workspaceId: opts.workspaceId, placeId: r.placeId } },
      select: { id: true, searchId: true }
    });
    if (existingOther && existingOther.searchId && existingOther.searchId !== opts.searchId) {
      return { skipped: true };
    }
  }

  // Calcular score
  const score = scoreLead({
    businessStatus: r.businessStatus,
    rating: r.rating,
    reviewsCount: r.userRatingCount,
    position: opts.position,
    website: r.website
  });

  // Ticket score: valor estimado del lead (sector premium, ya hace anuncios,
  // precio €€€, tamaño). Para priorizar la captación de ticket alto.
  const ticket = scoreTicket({
    name: r.name,
    category: r.category,
    types: r.types,
    priceLevel: r.priceLevel,
    reviewsCount: r.userRatingCount,
    website: r.website,
    runsAds: !!(r.rawData as any)?.runsAds,
    multiLocation: opts.multiLocation || !!(r.rawData as any)?.multiLocation
  });

  // Check de exclusión por nombre (lista negra manual del usuario).
  const exclusions = await prisma.leadExclusion.findMany({
    where: { workspaceId: opts.workspaceId, matchType: "name" }
  });
  const lowerName = r.name.toLowerCase();
  let excluded = false;
  let exclusionReason: string | null = null;
  for (const ex of exclusions) {
    const v = ex.matchValue.toLowerCase();
    const matched = ex.matchMode === "exact" ? lowerName === v : lowerName.includes(v);
    if (matched) {
      excluded = true;
      exclusionReason = ex.reason ?? `Patrón "${ex.matchValue}"`;
      break;
    }
  }

  // Si la IA marcó el lead como NO relevante con el keyword (p. ej. centro
  // de masaje terapéutico cuando se busca "masajes eróticos"), lo guardamos
  // pero excluido para que la cola de envío lo ignore.
  if (!excluded && opts.aiRelevance && opts.aiRelevance.relevant === false) {
    excluded = true;
    exclusionReason = `IA: ${opts.aiRelevance.reason || "no encaja con el keyword"}`;
  }

  const data = {
    workspaceId: opts.workspaceId,
    searchId: opts.searchId,
    placeId: r.placeId,
    name: r.name,
    address: r.formattedAddress,
    formattedAddress: r.formattedAddress,
    province: r.province ?? opts.province,
    phone: r.phone,
    internationalPhone: r.internationalPhone,
    website: r.website,
    // Email de contacto si la fuente lo trae (jobs lo extrae de la web). En el
    // update, undefined NO sobreescribe un email ya existente.
    email: (r.rawData as any)?.email ?? undefined,
    category: r.category,
    types: r.types,
    latitude: r.latitude,
    longitude: r.longitude,
    position: opts.position,
    gmbUrl: r.gmbUrl,
    businessStatus: r.businessStatus,
    priceLevel: r.priceLevel,
    rating: r.rating,
    reviewsCount: r.userRatingCount,
    rawData: r.rawData,
    score: score.score,
    urgency: score.urgency,
    scoreBreakdown: score.breakdown,
    ticketScore: ticket.ticketScore,
    ticketTier: ticket.ticketTier,
    contactStatus: excluded ? "excluded" : "pending",
    notes: excluded
      ? `Excluido: ${exclusionReason}`
      : (r.rawData as any)?.directorName
        ? `Directivo (BORME): ${(r.rawData as any).directorRole ?? "Cargo"} — ${(r.rawData as any).directorName}`
        : null
  };

  // En re-búsquedas no degradamos el progreso del funnel: si el lead ya está
  // como contactado / cliente / respondido / descartado manualmente, mantenemos
  // ese estado aunque la IA cambie de opinión sobre la relevancia.
  const existing = await prisma.lead.findUnique({
    where: { workspaceId_placeId: { workspaceId: opts.workspaceId, placeId: r.placeId } },
    select: { contactStatus: true, notes: true }
  });
  // "excluded" incluido: un lead vetado (opt-out / lista negra) NUNCA debe
  // volver a "pending" porque una re-búsqueda re-encuentre el mismo negocio.
  // Sin esto, "no volver a contactar" se perdía en la siguiente captación.
  const preserveStatuses = new Set(["contacted", "responded", "client", "discarded", "excluded"]);
  const updateData: any = { ...data, aiOpener: null, aiOpenerGeneratedAt: null };
  if (existing && preserveStatuses.has(existing.contactStatus)) {
    updateData.contactStatus = existing.contactStatus;
    updateData.notes = existing.notes;
  }

  await prisma.lead.upsert({
    where: { workspaceId_placeId: { workspaceId: opts.workspaceId, placeId: r.placeId } },
    create: data,
    // En el update limpiamos también el aiOpener antiguo (legado del plugin
    // WordPress) para que no aparezcan datos obsoletos en el mensaje.
    update: updateData
  });
}
