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
import { placesTextSearch, type PlacesResult } from "./google-places";
import { scoreLead } from "./scorer";
import { scoreTicket } from "./ticket-score";
import { SPAIN_PROVINCES, findProvince } from "./spain-provinces";
import { municipalitiesForProvince } from "./spain-municipalities";
import { expandKeyword } from "./synonyms";
import { classifyLeadsRelevance, type RelevanceVerdict } from "./relevance";
import { collectFromSource, type LeadSourceKey } from "./sources";

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
  if (source === "places") {
    if (opts.scope === "spain") {
      totalTargets = SPAIN_PROVINCES.length;
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
  type Target = { area: string; provinceTag: string; lat?: number; lng?: number };
  const cfg: any = (search as any).sourceConfig ?? {};
  const batchSize = opts.batchSize ?? 5;
  const from = search.processedProvinces;
  let targets: Target[];
  if (search.scope === "spain") {
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
  // Si Places lanza error en alguna provincia, guardamos el último para
  // surfacearlo en la UI si la búsqueda acaba con 0 leads.
  let batchError: string | null = null;
  for (const prov of targets) {
    try {
      await prisma.leadSearch.update({
        where: { id: search.id },
        data: { currentProvince: prov.area }
      });
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
          query: `${kw} en ${prov.area}`.trim(),
          lat: prov.lat || undefined,
          lng: prov.lng || undefined,
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
            skipExisting: search.skipExisting
          });
          if (upsertOut?.skipped) leadsSkipped++;
          else leadsInserted++;
        } catch (err) {
          console.error("[search-manager] upsert lead error:", err);
        }
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
    const verdicts = await classifyLeadsRelevance({
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
          skipExisting: search.skipExisting
        });
        if (upsertOut?.skipped) leadsSkipped++;
        else leadsInserted++;
      } catch (err) {
        console.error(`[search-manager ${source}] upsert lead error:`, err);
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

async function upsertLead(opts: {
  workspaceId: string;
  searchId: string;
  province: string;
  position: number;
  r: PlacesResult;
  aiRelevance: RelevanceVerdict | null;
  skipExisting?: boolean;
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
    runsAds: !!(r.rawData as any)?.runsAds
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
    notes: excluded ? `Excluido: ${exclusionReason}` : null
  };

  // En re-búsquedas no degradamos el progreso del funnel: si el lead ya está
  // como contactado / cliente / respondido / descartado manualmente, mantenemos
  // ese estado aunque la IA cambie de opinión sobre la relevancia.
  const existing = await prisma.lead.findUnique({
    where: { workspaceId_placeId: { workspaceId: opts.workspaceId, placeId: r.placeId } },
    select: { contactStatus: true, notes: true }
  });
  const preserveStatuses = new Set(["contacted", "responded", "client", "discarded"]);
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
