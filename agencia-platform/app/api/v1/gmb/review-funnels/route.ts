/**
 * Embudos de reseñas del workspace. GET → lista con URL pública y métricas. POST → crea uno a
 * partir de un negocio analizado (placeId). Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { publicBaseUrl } from "@/lib/public-url";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { buildGmbReviewUrl } from "@/lib/reviews/gmb-link";
import { funnelPublicUrl, placeById, uniqueSlug } from "@/lib/gmb/review-funnel";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({
  placeId: z.string().min(10).max(300),
  ownerEmail: z.string().email().max(200).or(z.literal("")).optional(),
  headline: z.string().max(200).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logoUrl: z.string().url().max(500).or(z.literal("")).optional()
});

async function metrics(workspaceId: string, ids: string[]) {
  if (!ids.length) return new Map<string, any>();
  const [events, fb] = await Promise.all([
    prisma.gmbReviewFunnelEvent.groupBy({ by: ["funnelId", "type"], where: { workspaceId, funnelId: { in: ids } }, _count: { _all: true } }),
    prisma.gmbReviewFunnelFeedback.groupBy({ by: ["funnelId", "status"], where: { workspaceId, funnelId: { in: ids } }, _count: { _all: true } })
  ]);
  const out = new Map<string, any>();
  for (const id of ids) out.set(id, { views: 0, stars: 0, google: 0, complaints: 0, pending: 0 });
  const key: Record<string, string> = { view: "views", star: "stars", google: "google", complaint: "complaints" };
  for (const e of events as any[]) {
    const m = out.get(e.funnelId);
    if (m && key[e.type]) m[key[e.type]] += e._count._all;
  }
  for (const f of fb as any[]) {
    const m = out.get(f.funnelId);
    if (m && f.status === "new") m.pending += f._count._all;
  }
  return out;
}

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const origin = publicBaseUrl(req);
  const funnels = await prisma.gmbReviewFunnel.findMany({ where: { workspaceId: api.workspaceId }, orderBy: { createdAt: "desc" }, take: 200 });
  const m = await metrics(api.workspaceId, funnels.map((f) => f.id));
  return NextResponse.json({
    ok: true,
    funnels: funnels.map((f) => ({ ...f, publicUrl: funnelPublicUrl(origin, f.slug), qrUrl: `${origin}/api/v1/gmb/review-funnels/${f.id}/qr`, metrics: m.get(f.id) }))
  });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", "Datos no válidos: revisa el email del dueño y el color.");
  const d = parsed.data;
  const reviewUrl = buildGmbReviewUrl(d.placeId);
  if (!reviewUrl) throw new ApiError(400, "validation_error", "Place ID no válido.");
  const place = await placeById(api.workspaceId, d.placeId).catch(() => null);
  if (!place) throw new ApiError(404, "not_found", "Google no encuentra ese negocio. Vuelve a analizarlo.");
  const ficha = await prisma.gmbClient.findFirst({ where: { workspaceId: api.workspaceId, placeId: place.placeId }, select: { id: true } }).catch(() => null);
  const funnel = await prisma.gmbReviewFunnel.create({
    data: {
      workspaceId: api.workspaceId,
      slug: await uniqueSlug(place.name),
      clientId: ficha?.id ?? "",
      businessName: place.name,
      placeId: place.placeId,
      address: place.address,
      phone: place.phone,
      website: place.website,
      category: place.category,
      rating: place.rating,
      ratingCount: place.ratingCount,
      mapsUrl: place.mapsUrl,
      reviewUrl: place.reviewUrl,
      ownerEmail: d.ownerEmail ?? "",
      headline: d.headline ?? "",
      color: d.color ?? "#F4600C",
      logoUrl: d.logoUrl ?? "",
      createdById: api.userId ?? null
    }
  });
  const origin = publicBaseUrl(req);
  return NextResponse.json({ ok: true, funnel: { ...funnel, publicUrl: funnelPublicUrl(origin, funnel.slug), qrUrl: `${origin}/api/v1/gmb/review-funnels/${funnel.id}/qr` } });
});
