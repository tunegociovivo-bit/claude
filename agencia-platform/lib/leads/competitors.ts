/**
 * Ranking de competencia en Google para un lead: consulta "[categoría] en
 * [zona]" en Google Places (sesgado a las coordenadas del negocio) y calcula en
 * qué POSICIÓN aparece el lead frente a sus competidores. Guarda el top en
 * LeadCompetitor y devuelve los datos para pintar el informe "tú vs competencia".
 */
import { prisma } from "@/lib/db/prisma";
import { placesTextSearch, getPlacePhotoDataUrl, type PlacesResult } from "./google-places";
import { scoreLead } from "./scorer";
import { scoreTicket } from "./ticket-score";

export type RankingLead = {
  id: string;
  placeId: string;
  name: string;
  category?: string | null;
  types?: any;
  province?: string | null;
  formattedAddress?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  rating?: number | null;
  reviewsCount?: number | null;
};

export type RankingRow = {
  position: number | null; // posición en Google (null = fuera del top consultado)
  name: string;
  rating: number | null;
  reviewsCount: number;
  isLead: boolean;
  photoDataUrl?: string | null; // foto real de la ficha (Places Photo), data URL JPEG
};

export type CompetitorRanking = {
  category: string;
  locality: string;
  query: string;
  leadPosition: number | null; // 1-based; null si no aparece en el top consultado
  aboveCount: number; // nº de competidores por delante del lead
  total: number; // resultados encontrados
  rows: RankingRow[]; // filas a mostrar (competidores de arriba + el lead)
  harvested?: { created: number; skipped: number }; // si opts.harvest
};

const SHOWN = 5; // filas en la tarjeta

/** Localidad legible para la consulta: provincia o, si no, "tu zona". */
function localityOf(lead: RankingLead): string {
  if (lead.province?.trim()) return lead.province.trim();
  // Intento básico desde la dirección formateada ("..., 28010 Madrid, España").
  const addr = lead.formattedAddress ?? lead.address ?? "";
  const m = /\b\d{4,5}\s+([A-Za-zÁÉÍÓÚÑáéíóúñ.\-\s]{2,40}?),/.exec(addr);
  if (m) return m[1].trim();
  return "";
}

/**
 * COSECHA DE COMPETENCIA: convierte en leads NUEVOS los competidores
 * encontrados (los que aún no están en el workspace). Reutiliza el trabajo del
 * informe de posicionamiento — cada lead que miras genera hasta 5 más. No toca
 * leads existentes (respeta su estado en el funnel).
 */
export async function harvestCompetitorsAsLeads(opts: {
  workspaceId: string;
  results: PlacesResult[];
  excludePlaceId?: string;
  province?: string;
}): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  let pos = 0;
  for (const r of opts.results) {
    pos++;
    if (!r.placeId) continue;
    if (opts.excludePlaceId && r.placeId === opts.excludePlaceId) continue;
    const existing = await prisma.lead.findUnique({
      where: { workspaceId_placeId: { workspaceId: opts.workspaceId, placeId: r.placeId } },
      select: { id: true }
    });
    if (existing) {
      skipped++;
      continue; // ya existe → no lo duplicamos ni tocamos su estado
    }
    const score = scoreLead({
      businessStatus: r.businessStatus,
      rating: r.rating,
      reviewsCount: r.userRatingCount,
      position: pos,
      website: r.website
    });
    const ticket = scoreTicket({
      name: r.name,
      category: r.category,
      types: r.types,
      priceLevel: r.priceLevel,
      reviewsCount: r.userRatingCount,
      website: r.website,
      runsAds: false,
      multiLocation: false
    });
    try {
      await prisma.lead.create({
        data: {
          workspaceId: opts.workspaceId,
          placeId: r.placeId,
          name: r.name,
          address: r.formattedAddress,
          formattedAddress: r.formattedAddress,
          province: r.province ?? opts.province ?? null,
          phone: r.phone,
          internationalPhone: r.internationalPhone,
          website: r.website,
          category: r.category,
          types: r.types,
          latitude: r.latitude,
          longitude: r.longitude,
          position: pos,
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
          contactStatus: "pending",
          notes: "🪃 Cosechado de competencia"
        } as any
      });
      created++;
    } catch {
      skipped++;
    }
  }
  return { created, skipped };
}

export async function getCompetitorRanking(
  workspaceId: string,
  lead: RankingLead,
  opts?: { store?: boolean; harvest?: boolean }
): Promise<CompetitorRanking | null> {
  const category =
    lead.category?.trim() ||
    (Array.isArray(lead.types) && lead.types[0] ? String(lead.types[0]).replace(/_/g, " ") : "") ||
    "negocio";
  const locality = localityOf(lead);
  const query = `${category}${locality ? ` en ${locality}` : ""}`;

  const results = await placesTextSearch({
    workspaceId,
    query,
    lat: lead.latitude ?? undefined,
    lng: lead.longitude ?? undefined,
    radiusMeters: 8000, // competencia LOCAL (no toda la provincia)
    maxPages: 1,
    pageSize: 20
  });
  if (!results.length) return null;

  const idx = results.findIndex((r) => r.placeId === lead.placeId);
  const leadPosition = idx >= 0 ? idx + 1 : null;
  const aboveCount = leadPosition ? leadPosition - 1 : results.length;

  // Filas a mostrar: si el lead está en el top SHOWN, mostramos ese top con él
  // resaltado; si no, mostramos los primeros (SHOWN-1) competidores + el lead.
  const rows: RankingRow[] = [];
  const photoNames: (string | null)[] = []; // foto por fila (paralelo a rows)
  const leadInTop = leadPosition != null && leadPosition <= SHOWN;
  const topCount = leadInTop ? SHOWN : SHOWN - 1;
  for (let i = 0; i < Math.min(topCount, results.length); i++) {
    const r = results[i];
    rows.push({
      position: i + 1,
      name: r.name,
      rating: r.rating,
      reviewsCount: r.userRatingCount ?? 0,
      isLead: r.placeId === lead.placeId
    });
    photoNames.push((r.rawData as any)?.photos?.[0]?.name ?? null);
  }
  if (!leadInTop) {
    rows.push({
      position: leadPosition, // null si fuera del top 20
      name: lead.name,
      rating: lead.rating ?? null,
      reviewsCount: lead.reviewsCount ?? 0,
      isLead: true
    });
    photoNames.push(null); // el lead fuera del top no viene en results → sin foto
  }

  // Fotos REALES de cada ficha (Places Photo → data URL JPEG, compatibles con
  // Satori). Best-effort y en paralelo. Coste: 1 llamada de foto por ficha
  // mostrada (~5). Si una falla, la miniatura cae al placeholder con la inicial.
  await Promise.all(
    rows.map(async (row, i) => {
      const pn = photoNames[i];
      if (!pn) return;
      row.photoDataUrl = await getPlacePhotoDataUrl({ workspaceId, photoName: pn, maxPx: 200 });
    })
  );

  // Guardar el top de competidores (sin el propio lead) para histórico/uso futuro.
  if (opts?.store !== false) {
    try {
      const comps = results
        .filter((r) => r.placeId !== lead.placeId)
        .slice(0, 5)
        .map((r, i) => ({
          leadId: lead.id,
          placeId: r.placeId,
          name: r.name,
          position: i + 1,
          rating: r.rating ?? null,
          reviewsCount: r.userRatingCount ?? 0
        }));
      await prisma.leadCompetitor.deleteMany({ where: { leadId: lead.id } });
      if (comps.length) await prisma.leadCompetitor.createMany({ data: comps });
    } catch {
      // El histórico es secundario; no rompemos el informe si falla.
    }
  }

  // Cosecha opcional: crea como leads los competidores que aún no tienes.
  let harvested: { created: number; skipped: number } | undefined;
  if (opts?.harvest) {
    harvested = await harvestCompetitorsAsLeads({
      workspaceId,
      results,
      excludePlaceId: lead.placeId,
      province: locality || lead.province || undefined
    });
  }

  return { category, locality, query, leadPosition, aboveCount, total: results.length, rows, harvested };
}
