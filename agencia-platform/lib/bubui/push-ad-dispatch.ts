import { prisma } from "@/lib/db/prisma";

/** Only paid, due campaigns enter the dispatcher. Concurrent workers claim once.
 * A failed/ambiguous delivery is retained for review, never silently resent. */
export async function dispatchDuePushAds() {
  const now = new Date();
  const due = await prisma.bubuiPushAd.findMany({ where: { status: "ready", startsAt: { lte: now } }, take: 25, orderBy: { startsAt: "asc" } });
  for (const ad of due) {
    const claimed = await prisma.bubuiPushAd.updateMany({ where: { id: ad.id, status: "ready" }, data: { status: ad.endsAt <= now ? "expired" : "sending" } });
    if (!claimed.count || ad.endsAt <= now) continue;
    try { await sendBubuiPushAd(ad.id); }
    catch (error) {
      await prisma.bubuiPushAd.updateMany({ where: { id: ad.id, status: "sending" }, data: { status: "failed" } });
      console.error("[bubui push-ad delivery failed]", ad.id, error);
    }
  }
}

/** Envía el push del Push del Día a clientes Bubui en el radio configurado.
 *  v1 simple: filtra por última geolocalización registrada del cliente y
 *  por suscripción push activa. */
async function sendBubuiPushAd(adId: string): Promise<void> {
  const ad = await prisma.bubuiPushAd.findUnique({
    where: { id: adId },
    include: { business: { select: { name: true } } }
  });
  if (!ad) return;

  const { haversineMeters } = await import("@/lib/bubui/core");
  const { notifyBubuiCustomer } = await import("@/lib/bubui/notify");

  // Candidatos: clientes con CUALQUIER canal push (web PWA o token móvil) y
  // última ubicación reciente. Antes solo se miraban las suscripciones web,
  // dejando fuera a los usuarios de la app móvil.
  const [webSubs, mobileSubs] = await Promise.all([
    prisma.bubuiPushSubscription.findMany({ select: { customerId: true }, distinct: ["customerId"] }),
    prisma.bubuiMobilePushToken.findMany({ select: { customerId: true }, distinct: ["customerId"] })
  ]);
  const candidateIds = Array.from(
    new Set([...webSubs.map((s) => s.customerId), ...mobileSubs.map((s) => s.customerId)])
  );
  let sent = 0;
  for (const customerId of candidateIds) {
    const c = await prisma.bubuiCustomer.findUnique({ where: { id: customerId } });
    if (c?.lastLat == null || c?.lastLng == null) continue;
    const d = haversineMeters(c.lastLat, c.lastLng, ad.centerLat, ad.centerLng);
    if (d > ad.radiusKm * 1000) continue;
    await notifyBubuiCustomer(c.id, {
      title: ad.title,
      body: ad.body,
      image: ad.imageUrl ?? undefined,
      link: `/bubui/app`,
      tag: `pushad-${ad.id}`
    });
    sent++;
  }
  await prisma.bubuiPushAd.update({
    where: { id: ad.id },
    data: { sentCount: sent, status: "done" }
  });
}
