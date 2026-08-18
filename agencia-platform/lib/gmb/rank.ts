/**
 * Rank Grid + Competencia — helpers PUROS (sin red). Generación de la cuadrícula geolocalizada,
 * agregación de una medición y análisis de gaps frente a competidores. El proveedor real (Google
 * Maps) se decide por presencia de credenciales; sin ellas, estado "sin conectar" honesto: NUNCA se
 * fabrican posiciones.
 */

export type GridCell = { row: number; col: number; lat: number; lng: number; position?: number | null };

/** Grado de latitud ≈ 111 km; longitud escala por cos(lat). Genera una cuadrícula NxN centrada. */
export function buildGrid(centerLat: number, centerLng: number, size: number, stepKm: number): GridCell[] {
  const n = Math.max(1, Math.min(size, 9));
  const half = (n - 1) / 2;
  const dLat = stepKm / 111;
  const dLng = stepKm / (111 * Math.max(0.1, Math.cos((centerLat * Math.PI) / 180)));
  const cells: GridCell[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      cells.push({ row, col, lat: +(centerLat + (row - half) * dLat).toFixed(6), lng: +(centerLng + (col - half) * dLng).toFixed(6) });
    }
  }
  return cells;
}

export type GridStats = { cellCount: number; foundCount: number; top3Count: number; avgPosition: number; visibilityShare: number };

/** Agrega una medición: posición media (solo celdas donde aparece), top3, cobertura. */
export function aggregateGrid(cells: { position?: number | null }[]): GridStats {
  const cellCount = cells.length;
  const found = cells.filter((c) => typeof c.position === "number" && (c.position as number) > 0) as { position: number }[];
  const top3 = found.filter((c) => c.position <= 3).length;
  const avg = found.length ? found.reduce((s, c) => s + c.position, 0) / found.length : 0;
  return {
    cellCount,
    foundCount: found.length,
    top3Count: top3,
    avgPosition: Math.round(avg * 10) / 10,
    visibilityShare: cellCount ? Math.round((found.length / cellCount) * 100) : 0
  };
}

export type Competitor = { name: string; rating?: number | null; reviewCount?: number | null; categories?: string[] };
export type CompetitorGap = {
  market: { avgRating: number; avgReviews: number; count: number };
  you: { rating: number; reviewCount: number };
  reviewGap: number; // cuántas reseñas por debajo de la media (negativo = por encima)
  ratingGap: number; // diferencia de nota media
  categoryGaps: string[]; // categorías que tienen competidores y tú no
  ahead: boolean;
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export function competitorGaps(you: { rating: number; reviewCount: number; categories?: string[] }, competitors: Competitor[]): CompetitorGap {
  const rated = competitors.filter((c) => typeof c.rating === "number");
  const avgRating = rated.length ? rated.reduce((s, c) => s + (c.rating || 0), 0) / rated.length : 0;
  const withReviews = competitors.filter((c) => typeof c.reviewCount === "number");
  const avgReviews = withReviews.length ? withReviews.reduce((s, c) => s + (c.reviewCount || 0), 0) / withReviews.length : 0;
  const yourCats = new Set((you.categories ?? []).map(norm));
  const compCats = new Set<string>();
  for (const c of competitors) for (const cat of c.categories ?? []) compCats.add(norm(cat));
  const categoryGaps = [...compCats].filter((c) => c && !yourCats.has(c));
  return {
    market: { avgRating: Math.round(avgRating * 10) / 10, avgReviews: Math.round(avgReviews), count: competitors.length },
    you: { rating: you.rating, reviewCount: you.reviewCount },
    reviewGap: Math.round(avgReviews - you.reviewCount),
    ratingGap: Math.round((avgRating - you.rating) * 10) / 10,
    categoryGaps: categoryGaps.slice(0, 8),
    ahead: you.rating >= avgRating && you.reviewCount >= avgReviews
  };
}

export type ProviderStatus = { provider: "google_maps"; connected: boolean; reason?: string };

/** Estado del proveedor de rank/competencia SIN red: conectado si hay clave de Maps. */
export function rankProviderStatus(env: NodeJS.ProcessEnv = process.env): ProviderStatus {
  const key = env.GOOGLE_MAPS_API_KEY || env.MAPS_API_KEY || env.GOOGLE_MAPS_KEY;
  return key && String(key).trim() ? { provider: "google_maps", connected: true } : { provider: "google_maps", connected: false, reason: "sin_clave_maps" };
}
