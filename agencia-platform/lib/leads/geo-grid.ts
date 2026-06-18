/**
 * Cuadrícula geográfica para captación de leads.
 *
 * Google Places (New) corta cada consulta en ~60 resultados. Para zonas densas
 * (una ciudad puede tener cientos de negocios de un nicho) eso deja fuera la
 * mayoría. Solución: dividir el área en una rejilla de puntos y consultar cada
 * celda con un radio pequeño (locationBias). Uniendo todas las celdas y
 * deduplicando por placeId (el upsert por workspaceId+placeId ya lo hace),
 * se capturan muchos más negocios de la misma zona.
 */

export type GridPoint = { lat: number; lng: number };

/**
 * Genera los centros de celda de una rejilla cuadrada centrada en (lat,lng).
 * `halfSpanKm` = medio lado del cuadrado (la rejilla cubre 2·halfSpan de lado).
 * `stepKm` = separación entre celdas. Devuelve también el radio recomendado por
 * celda (media diagonal del paso, con solape para no dejar huecos).
 */
export function buildGridPoints(opts: {
  lat: number;
  lng: number;
  halfSpanKm: number;
  stepKm: number;
  maxCells?: number;
}): { cells: GridPoint[]; cellRadiusMeters: number } {
  const { lat, lng } = opts;
  const halfSpanKm = Math.max(1, opts.halfSpanKm);
  let stepKm = Math.max(0.5, opts.stepKm);
  const maxCells = opts.maxCells ?? 64;

  const kmPerDegLat = 110.574;
  const kmPerDegLng = 111.32 * Math.cos((lat * Math.PI) / 180) || 111.32;

  // Si la rejilla excediera maxCells, agrandamos el paso hasta encajar.
  let perSide = Math.floor((halfSpanKm * 2) / stepKm) + 1;
  while (perSide * perSide > maxCells && stepKm < halfSpanKm * 2) {
    stepKm *= 1.25;
    perSide = Math.floor((halfSpanKm * 2) / stepKm) + 1;
  }

  const cells: GridPoint[] = [];
  for (let i = 0; i < perSide; i++) {
    const dyKm = -halfSpanKm + i * stepKm;
    for (let j = 0; j < perSide; j++) {
      const dxKm = -halfSpanKm + j * stepKm;
      cells.push({
        lat: lat + dyKm / kmPerDegLat,
        lng: lng + dxKm / kmPerDegLng
      });
    }
  }
  // Radio de celda: media diagonal del paso ·1.3 para solapar y no dejar huecos.
  const cellRadiusMeters = Math.round((stepKm / Math.SQRT2) * 1000 * 1.3);
  return { cells, cellRadiusMeters };
}
