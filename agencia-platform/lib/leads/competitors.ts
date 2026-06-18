/**
 * Ranking de competencia en Google para un lead: consulta "[categoría] en
 * [zona]" en Google Places (sesgado a las coordenadas del negocio) y calcula en
 * qué POSICIÓN aparece el lead frente a sus competidores. Guarda el top en
 * LeadCompetitor y devuelve los datos para pintar el informe "tú vs competencia".
 */
import { prisma } from "@/lib/db/prisma";
import { placesTextSearch } from "./google-places";

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
};

export type CompetitorRanking = {
  category: string;
  locality: string;
  query: string;
  leadPosition: number | null; // 1-based; null si no aparece en el top consultado
  aboveCount: number; // nº de competidores por delante del lead
  total: number; // resultados encontrados
  rows: RankingRow[]; // filas a mostrar (competidores de arriba + el lead)
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

export async function getCompetitorRanking(
  workspaceId: string,
  lead: RankingLead,
  opts?: { store?: boolean }
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
  }
  if (!leadInTop) {
    rows.push({
      position: leadPosition, // null si fuera del top 20
      name: lead.name,
      rating: lead.rating ?? null,
      reviewsCount: lead.reviewsCount ?? 0,
      isLead: true
    });
  }

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

  return { category, locality, query, leadPosition, aboveCount, total: results.length, rows };
}
