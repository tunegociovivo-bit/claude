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
import { SPAIN_PROVINCES, findProvince } from "./spain-provinces";

export async function startSearch(opts: {
  workspaceId: string;
  userId?: string | null;
  keyword: string;
  location: string;
  scope: "custom" | "spain";
}): Promise<{ searchId: string; totalProvinces: number }> {
  const totalProvinces = opts.scope === "spain" ? SPAIN_PROVINCES.length : 1;
  const search = await prisma.leadSearch.create({
    data: {
      workspaceId: opts.workspaceId,
      keyword: opts.keyword.trim(),
      location: opts.location.trim() || (opts.scope === "spain" ? "Toda España" : ""),
      scope: opts.scope,
      totalProvinces,
      processedProvinces: 0,
      status: "PENDING"
    }
  });
  return { searchId: search.id, totalProvinces };
}

/**
 * Procesa un batch de provincias para la búsqueda dada. Devuelve cuántas
 * provincias quedan por procesar.
 */
export async function processSearchBatch(opts: {
  workspaceId: string;
  searchId: string;
  batchSize?: number;
}): Promise<{ processed: number; pending: number; status: string; leadsInserted: number }> {
  const search = await prisma.leadSearch.findFirst({
    where: { id: opts.searchId, workspaceId: opts.workspaceId }
  });
  if (!search) throw new Error("Búsqueda no encontrada");
  if (["COMPLETED", "FAILED"].includes(search.status)) {
    return { processed: search.processedProvinces, pending: 0, status: search.status, leadsInserted: 0 };
  }

  await prisma.leadSearch.update({
    where: { id: search.id },
    data: { status: "RUNNING", startedAt: search.startedAt ?? new Date() }
  });

  const targets =
    search.scope === "spain"
      ? SPAIN_PROVINCES.slice(search.processedProvinces, search.processedProvinces + (opts.batchSize ?? 5))
      : findProvince(search.location)
        ? [findProvince(search.location)!]
        : [{ name: search.location, capital: search.location, lat: 0, lng: 0, ccaa: "" }];

  let leadsInserted = 0;
  // Si Places lanza error en alguna provincia, guardamos el último para
  // surfacearlo en la UI si la búsqueda acaba con 0 leads.
  let batchError: string | null = null;
  for (const prov of targets) {
    try {
      await prisma.leadSearch.update({
        where: { id: search.id },
        data: { currentProvince: prov.name }
      });
      const query = `${search.keyword} en ${prov.name}`.trim();
      const results = await placesTextSearch({
        workspaceId: opts.workspaceId,
        query,
        lat: prov.lat || undefined,
        lng: prov.lng || undefined,
        province: prov.name
      });
      let position = 1;
      for (const r of results) {
        try {
          await upsertLead({
            workspaceId: opts.workspaceId,
            searchId: search.id,
            province: prov.name,
            position: position++,
            r
          });
          leadsInserted++;
        } catch (err) {
          console.error("[search-manager] upsert lead error:", err);
        }
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error(`[search-manager] provincia ${prov.name} fallo:`, msg);
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
      completedAt: pending === 0 ? new Date() : null
    }
  });

  return { processed: newProcessed, pending, status: newStatus, leadsInserted };
}

async function upsertLead(opts: {
  workspaceId: string;
  searchId: string;
  province: string;
  position: number;
  r: PlacesResult;
}) {
  const { r } = opts;
  if (!r.placeId) return;

  // Calcular score
  const score = scoreLead({
    businessStatus: r.businessStatus,
    rating: r.rating,
    reviewsCount: r.userRatingCount,
    position: opts.position,
    website: r.website
  });

  // Check de exclusión por nombre
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
    contactStatus: excluded ? "excluded" : "pending",
    notes: excluded ? `Excluido: ${exclusionReason}` : null
  };

  await prisma.lead.upsert({
    where: { workspaceId_placeId: { workspaceId: opts.workspaceId, placeId: r.placeId } },
    create: data,
    // En el update limpiamos también el aiOpener antiguo (legado del plugin
    // WordPress) para que no aparezcan en el mensaje datos obsoletos —p.ej.
    // "posición 24" cuando la nueva búsqueda dice "posición 13"—. El opener
    // se regenerará a partir de los datos actuales si en el futuro se vuelve
    // a generar; mientras tanto el placeholder {{opener_ia}} se renderiza
    // vacío y el resto del mensaje sigue siendo válido.
    update: { ...data, aiOpener: null, aiOpenerGeneratedAt: null }
  });
}
