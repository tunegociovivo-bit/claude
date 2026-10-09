/**
 * Importa las reseñas de una ficha vinculada directamente desde Google (API oficial v4, vía OAuth
 * del Hub o la pasarela de Make). Así el Hub muestra el histórico completo aunque el escenario de
 * Make solo avise de las reseñas nuevas. Idempotente: upsert por (ficha, reviewId).
 */
import { prisma } from "@/lib/db/prisma";
import { gbpCall, gbpSourceForClient, gmbLocationPath } from "@/lib/integrations/gmb";
import { cleanReviewText, logGmbActivity } from "@/lib/integrations/gmb-hub";

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const SYNC_ACTION = "reviews_synced";

export type ReviewSyncResult = { imported: number; updated: number; total: number; rating: number | null; count: number | null };

export async function syncClientReviews(workspaceId: string, clientId: string, opts: { maxPages?: number } = {}): Promise<ReviewSyncResult> {
  const client = await prisma.gmbClient.findFirst({ where: { id: clientId, workspaceId } });
  if (!client) throw new Error("Ficha no encontrada");
  const path = gmbLocationPath(client.accountId, client.locationId);
  if (!path) throw new Error("La ficha no está vinculada a Google (falta cuenta/ubicación).");
  const source = gbpSourceForClient(client);

  // Datos de la ficha (web, teléfono, dirección, categoría, placeId) tal como están en Google.
  await refreshLocationInfo(workspaceId, client.id, path, source).catch(() => undefined);

  const existing = new Set(
    (await prisma.gmbReview.findMany({ where: { workspaceId, clientId: client.id }, select: { reviewId: true } })).map((r) => r.reviewId)
  );
  let imported = 0;
  let updated = 0;
  let total = 0;
  let rating: number | null = null;
  let count: number | null = null;
  let pageToken = "";
  for (let i = 0; i < (opts.maxPages ?? 10); i++) {
    const qs = new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc" });
    if (pageToken) qs.set("pageToken", pageToken);
    const data = await gbpCall(workspaceId, source, { api: "v4", path: `/v4/${path}/reviews?${qs}` });
    if (i === 0) {
      rating = typeof data?.averageRating === "number" ? data.averageRating : null;
      count = typeof data?.totalReviewCount === "number" ? data.totalReviewCount : null;
    }
    for (const r of data?.reviews ?? []) {
      const reviewId = String(r.reviewId || String(r.name ?? "").split("/").pop() || "");
      if (!reviewId) continue;
      total++;
      const row = {
        authorName: r.reviewer?.displayName ?? "Anónimo",
        authorPhoto: r.reviewer?.profilePhotoUrl ?? "",
        rating: STARS[r.starRating] ?? 0,
        comment: cleanReviewText(r.comment),
        reviewReply: r.reviewReply?.comment ?? null,
        reviewTime: r.createTime ? new Date(r.createTime) : null,
        updateTime: r.updateTime ? new Date(r.updateTime) : null
      };
      await prisma.gmbReview.upsert({
        where: { clientId_reviewId: { clientId: client.id, reviewId } },
        create: { workspaceId, clientId: client.id, reviewId, ...row },
        update: row
      });
      if (existing.has(reviewId)) updated++;
      else imported++;
    }
    pageToken = data?.nextPageToken ?? "";
    if (!pageToken) break;
  }
  const data: Record<string, number> = {};
  if (rating != null) data.rating = Math.round(rating * 10) / 10;
  if (count != null) data.reviewCount = count;
  if (Object.keys(data).length) await prisma.gmbClient.updateMany({ where: { id: client.id, workspaceId }, data });
  await logGmbActivity({
    workspaceId,
    clientId: client.id,
    actionType: SYNC_ACTION,
    description: `Reseñas sincronizadas con Google: ${imported} nuevas, ${updated} actualizadas`
  }).catch(() => {});
  return { imported, updated, total, rating, count };
}

/** ¿Hace falta sincronizar? (nunca sincronizada o hace más de `hours` horas). */
export async function reviewSyncDue(workspaceId: string, clientId: string, hours = 3): Promise<boolean> {
  const last = await prisma.gmbActivity.findFirst({
    where: { workspaceId, clientId, actionType: SYNC_ACTION },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true }
  });
  return !last || Date.now() - last.createdAt.getTime() > hours * 3_600_000;
}

const INFO_MASK = "title,websiteUri,phoneNumbers,categories,storefrontAddress,metadata";

/** Actualiza los datos de la ficha en el Hub con los de Google (solo los campos que Google trae). */
export async function refreshLocationInfo(workspaceId: string, clientId: string, path: string, source: ReturnType<typeof gbpSourceForClient>) {
  const loc = path.split("/locations/")[1];
  const l = await gbpCall(workspaceId, source, { api: "info", path: `/v1/locations/${loc}?readMask=${encodeURIComponent(INFO_MASK)}` });
  const a = l?.storefrontAddress;
  const address = a
    ? [...(a.addressLines ?? []), [a.postalCode, a.locality].filter(Boolean).join(" "), a.administrativeArea].filter(Boolean).join(", ")
    : "";
  const data: Record<string, string> = {};
  if (l?.title) data.name = String(l.title);
  if (l?.websiteUri) data.website = String(l.websiteUri);
  if (l?.phoneNumbers?.primaryPhone) data.phone = String(l.phoneNumbers.primaryPhone);
  if (l?.categories?.primaryCategory?.displayName) data.category = String(l.categories.primaryCategory.displayName);
  if (address) data.address = address;
  if (l?.metadata?.placeId) data.placeId = String(l.metadata.placeId);
  if (Object.keys(data).length) await prisma.gmbClient.updateMany({ where: { id: clientId, workspaceId }, data });
  return data;
}
