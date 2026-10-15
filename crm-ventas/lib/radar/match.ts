import "server-only";
import { prisma } from "@/lib/prisma";
import { parseCriteria, matchesCriteria, type MatchableListing } from "./criteria";

// Cruza los coches activos de un negocio con sus búsquedas guardadas y crea un
// RadarMatch por (búsqueda, coche) la primera vez. No duplica: la clave única
// (searchId, listingId) lo garantiza, y solo se avisa de los matches sin avisar.

export type NewMatch = {
  matchId: string;
  searchId: string;
  searchName: string;
  listingId: string;
  notifyWhatsapp: boolean;
  notifyEmail: boolean;
};

/** Evalúa las búsquedas activas contra un conjunto de coches (por id). Devuelve los matches nuevos. */
export async function evaluateMatches(workspaceId: string, listingIds: string[]): Promise<NewMatch[]> {
  if (listingIds.length === 0) return [];
  const [searches, listings] = await Promise.all([
    prisma.radarSearch.findMany({ where: { workspaceId, active: true } }),
    prisma.radarListing.findMany({
      where: { workspaceId, id: { in: listingIds }, active: true },
      select: {
        id: true, portal: true, title: true, make: true, model: true, version: true,
        year: true, km: true, price: true, fuel: true, gearbox: true, powerCv: true, country: true,
      },
    }),
  ]);
  if (searches.length === 0 || listings.length === 0) return [];

  const out: NewMatch[] = [];
  for (const search of searches) {
    const criteria = parseCriteria(search.criteria);
    const hits = listings.filter((l) => matchesCriteria(l as MatchableListing, criteria));
    if (hits.length === 0) continue;
    // Crea los matches que falten (ignora los que ya existían).
    await prisma.radarMatch.createMany({
      data: hits.map((l) => ({ workspaceId, searchId: search.id, listingId: l.id, status: "new" })),
      skipDuplicates: true,
    });
    const created = await prisma.radarMatch.findMany({
      where: { searchId: search.id, listingId: { in: hits.map((l) => l.id) }, notifiedAt: null, notifyError: null },
      select: { id: true, listingId: true },
    });
    for (const m of created) {
      out.push({
        matchId: m.id,
        searchId: search.id,
        searchName: search.name,
        listingId: m.listingId,
        notifyWhatsapp: search.notifyWhatsapp,
        notifyEmail: search.notifyEmail,
      });
    }
  }
  return out;
}

/** Recalcula una búsqueda contra TODO el stock activo (al crear o editar una búsqueda). */
export async function evaluateSearchAgainstAll(workspaceId: string, searchId: string): Promise<number> {
  const ids = await prisma.radarListing.findMany({ where: { workspaceId, active: true }, select: { id: true } });
  const matches = await evaluateMatches(workspaceId, ids.map((l) => l.id));
  return matches.filter((m) => m.searchId === searchId).length;
}
