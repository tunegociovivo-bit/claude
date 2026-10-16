import "server-only";
import { prisma } from "@/lib/prisma";
import { getPortal, portalFallbackUrl } from "./portals";

export type MatchView = {
  matchId: string;
  status: string;
  searchId: string;
  searchName: string;
  notifiedAt: string | null;
  createdAt: string;
  listing: {
    id: string; portal: string; portalName: string; title: string; url: string | null;
    make: string | null; model: string | null; version: string | null; year: number | null;
    km: number | null; price: number | null; priceLabel: string | null; fuel: string | null;
    gearbox: string | null; powerCv: number | null; country: string | null; location: string | null;
    auctionEndsAt: string | null; imageUrl: string | null; active: boolean; firstSeenAt: string;
  };
};

const STATUSES = ["new", "seen", "interesting", "discarded"] as const;

export async function listMatches(opts: {
  workspaceId: string;
  status?: string;
  searchId?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ matches: MatchView[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const where: any = { workspaceId: opts.workspaceId };
  if (opts.status && STATUSES.includes(opts.status as any)) where.status = opts.status;
  if (opts.searchId) where.searchId = opts.searchId;

  const rows = await prisma.radarMatch.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: { listing: true, search: { select: { name: true } } },
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    matches: page.map((m) => {
      const portal = getPortal(m.listing.portal);
      // Si el coche no trae ficha propia, se enlaza a la zona de subastas del
      // portal (ya logueada) para poder ir a pujar igualmente.
      const url = m.listing.url ?? (portal ? portalFallbackUrl(portal) : null);
      return {
      matchId: m.id,
      status: m.status,
      searchId: m.searchId,
      searchName: m.search.name,
      notifiedAt: m.notifiedAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      listing: {
        id: m.listing.id,
        portal: m.listing.portal,
        portalName: portal?.name ?? m.listing.portal,
        title: m.listing.title,
        url,
        make: m.listing.make,
        model: m.listing.model,
        version: m.listing.version,
        year: m.listing.year,
        km: m.listing.km,
        price: m.listing.price,
        priceLabel: m.listing.priceLabel,
        fuel: m.listing.fuel,
        gearbox: m.listing.gearbox,
        powerCv: m.listing.powerCv,
        country: m.listing.country,
        location: m.listing.location,
        auctionEndsAt: m.listing.auctionEndsAt?.toISOString() ?? null,
        imageUrl: m.listing.imageUrl,
        active: m.listing.active,
        firstSeenAt: m.listing.firstSeenAt.toISOString(),
      },
      };
    }),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export async function setMatchStatus(workspaceId: string, matchId: string, status: string): Promise<void> {
  if (!STATUSES.includes(status as any)) throw new Error("Estado no válido");
  const result = await prisma.radarMatch.updateMany({ where: { id: matchId, workspaceId }, data: { status } });
  if (result.count === 0) throw new Error("Coincidencia no encontrada");
}

export async function radarCounts(workspaceId: string): Promise<{ new: number; total: number }> {
  const [newCount, total] = await Promise.all([
    prisma.radarMatch.count({ where: { workspaceId, status: "new" } }),
    prisma.radarMatch.count({ where: { workspaceId } }),
  ]);
  return { new: newCount, total };
}
