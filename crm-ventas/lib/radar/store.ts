import "server-only";
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/ai/crypto";
import type { ExtractedVehicle } from "./extract-json";
import { getPortal, urlBelongsToPortal } from "./portals";

// Guardado de coches y de las sesiones (cookies) de cada portal.

export type UpsertResult = { listingId: string; isNew: boolean; priceDropped: boolean };

/** Inserta o actualiza un coche visto en un portal. No pisa datos buenos con nulos. */
export async function upsertListing(opts: {
  workspaceId: string;
  sourceId: string;
  portal: string;
  vehicle: ExtractedVehicle;
}): Promise<UpsertResult> {
  const { workspaceId, sourceId, portal, vehicle: v } = opts;
  const portalDef = getPortal(portal);
  const url = v.url && portalDef && urlBelongsToPortal(portalDef, v.url) ? v.url : v.url && !portalDef ? v.url : null;
  const now = new Date();
  const existing = await prisma.radarListing.findUnique({
    where: { workspaceId_portal_externalId: { workspaceId, portal, externalId: v.externalId } },
    select: { id: true, price: true },
  });

  const data = {
    url: url ?? undefined,
    title: v.title,
    make: v.make ?? undefined,
    model: v.model ?? undefined,
    version: v.version ?? undefined,
    year: v.year ?? undefined,
    km: v.km ?? undefined,
    fuel: v.fuel ?? undefined,
    gearbox: v.gearbox ?? undefined,
    powerCv: v.powerCv ?? undefined,
    bodyType: v.bodyType ?? undefined,
    color: v.color ?? undefined,
    country: v.country ?? undefined,
    location: v.location ?? undefined,
    auctionEndsAt: v.auctionEndsAt ?? undefined,
    imageUrl: v.imageUrl ?? undefined,
    priceLabel: v.priceLabel ?? undefined,
    raw: (v.raw as any) ?? undefined,
  };

  if (!existing) {
    const created = await prisma.radarListing.create({
      data: {
        workspaceId,
        sourceId,
        portal,
        externalId: v.externalId,
        price: v.price ?? undefined,
        active: true,
        firstSeenAt: now,
        lastSeenAt: now,
        ...data,
      },
      select: { id: true },
    });
    return { listingId: created.id, isNew: true, priceDropped: false };
  }

  const priceDropped = existing.price !== null && v.price !== null && v.price < existing.price;
  await prisma.radarListing.update({
    where: { id: existing.id },
    data: {
      ...data,
      active: true,
      lastSeenAt: now,
      ...(v.price !== null
        ? {
            price: v.price,
            ...(existing.price !== null && v.price !== existing.price
              ? { previousPrice: existing.price, priceChangedAt: now }
              : {}),
          }
        : {}),
    },
  });
  return { listingId: existing.id, isNew: false, priceDropped };
}

/** Marca como inactivos los coches de un portal que ya no se han visto hoy. */
export async function deactivateStale(workspaceId: string, portal: string, seenBefore: Date): Promise<number> {
  const result = await prisma.radarListing.updateMany({
    where: { workspaceId, portal, active: true, lastSeenAt: { lt: seenBefore } },
    data: { active: false },
  });
  return result.count;
}

export async function saveSession(sourceId: string, storageState: unknown): Promise<void> {
  try {
    const enc = encryptSecret(JSON.stringify(storageState));
    await prisma.radarSource.update({ where: { id: sourceId }, data: { sessionEnc: enc, sessionSavedAt: new Date() } });
  } catch {
    // Si no se puede guardar la sesión, el siguiente pase vuelve a iniciarla.
  }
}

export async function loadSession(sourceId: string): Promise<unknown | null> {
  const row = await prisma.radarSource.findUnique({ where: { id: sourceId }, select: { sessionEnc: true, sessionSavedAt: true } });
  if (!row?.sessionEnc || !row.sessionSavedAt) return null;
  // Las cookies caducan: una sesión de más de 20 días no se reutiliza.
  if (Date.now() - row.sessionSavedAt.getTime() > 20 * 24 * 3600_000) return null;
  const json = decryptSecret(row.sessionEnc);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function sourceCredentials(source: { usernameEnc: string | null; passwordEnc: string | null }): { username: string; password: string } | null {
  const username = source.usernameEnc ? decryptSecret(source.usernameEnc) : null;
  const password = source.passwordEnc ? decryptSecret(source.passwordEnc) : null;
  if (!username || !password) return null;
  return { username, password };
}
