/**
 * Adapter del proveedor de Rank Grid. Interfaz estable + implementación REAL (Google Maps, reusa
 * `gridRank`) + resolución honesta: si no hay clave de Maps, NO hay proveedor (bloqueo honesto, se
 * inyecta un provider fake solo en tests). Nunca inventa posiciones.
 */
export type RankCell = { lat: number; lng: number; position: number | null };
export type RankMeasurement = { keyword: string; avgPosition: number; foundCount: number; top3Count: number; cellCount: number; cells: RankCell[] };

export interface RankProvider {
  id: string;
  measure(opts: { workspaceId: string; keyword: string; businessName: string; placeId?: string | null; lat: number; lng: number; gridSize: number; radiusKm: number }): Promise<RankMeasurement>;
}

/** Proveedor REAL con Google Maps. Lanza si no hay clave (lo captura el job → error visible). */
export const googleMapsRankProvider: RankProvider = {
  id: "google_maps",
  async measure(opts) {
    const { gridRank } = await import("@/lib/integrations/google-maps");
    const res = await gridRank({ workspaceId: opts.workspaceId, lat: opts.lat, lng: opts.lng, keyword: opts.keyword, businessName: opts.businessName, placeId: opts.placeId ?? undefined, size: opts.gridSize, radiusKm: opts.radiusKm });
    return { keyword: opts.keyword, avgPosition: res.avgPosition, foundCount: res.foundCount, top3Count: res.top3Count, cellCount: res.cellCount, cells: res.cells };
  }
};

/**
 * Resuelve el proveedor de rank para el workspace. Devuelve null si NO hay credenciales (bloqueo
 * honesto). `deps.mapsKey` inyectable en tests; por defecto lee la clave real del workspace.
 */
export async function resolveRankProvider(workspaceId: string, deps: { hasKey?: () => Promise<boolean>; provider?: RankProvider } = {}): Promise<RankProvider | null> {
  if (deps.provider) return deps.provider;
  const hasKey = deps.hasKey ? await deps.hasKey() : await defaultHasMapsKey(workspaceId);
  return hasKey ? googleMapsRankProvider : null;
}

async function defaultHasMapsKey(workspaceId: string): Promise<boolean> {
  try {
    const { getGmbMapsKey } = await import("@/lib/integrations/gmb-hub");
    return !!(await getGmbMapsKey(workspaceId));
  } catch {
    return false;
  }
}
