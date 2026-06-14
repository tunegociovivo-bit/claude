/**
 * GET /api/bubui/banner  (público)
 * Banner del Home que consume la app móvil.
 *
 * Prioridad:
 *   1. Banner manual del admin si está activo (override total).
 *   2. Campaña de banner ganada por un negocio (referidos B2B), servida por
 *      turnos desde la cola, si tiene imagen.
 *   3. { active:false } → la app usa su banner por defecto.
 *
 * Además del { imageUrl, active, link } clásico, puede devolver `business`:
 * un objeto con forma de ficha (BusinessLite) para que la app, al tocar el
 * banner, abra la pantalla Negocio en vez de un enlace externo. Se rellena
 * cuando el banner promociona un comercio (kind="business") o es una
 * promoción interna (kind="promo", ficha sintética).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getHomeBanner, type HomeBanner } from "@/lib/bubui/banner";
import { tickBannerQueue } from "@/lib/bubui/business-referral";

export const dynamic = "force-dynamic";

/** Ficha (BusinessLite) que la app sabe abrir en la pantalla Negocio. */
type BannerBusiness = {
  id: string;
  slug: string;
  name: string;
  category: string;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  logoUrl?: string | null;
  brandColor?: string | null;
  defaultDiscountPct?: number;
  discountPct?: number;
  // Campos de promoción interna (la pantalla Negocio los renderiza si vienen).
  description?: string | null;
  ctaLabel?: string | null;
  ctaLink?: string | null;
  isPromo?: boolean;
};

async function resolveBusiness(banner: HomeBanner): Promise<BannerBusiness | null> {
  if (banner.kind === "business" && banner.businessId) {
    const b = await prisma.bubuiBusiness.findUnique({
      where: { id: banner.businessId },
      select: {
        id: true,
        slug: true,
        name: true,
        category: true,
        city: true,
        address: true,
        phone: true,
        latitude: true,
        longitude: true,
        logoUrl: true,
        brandColor: true,
        defaultDiscountPct: true,
        active: true
      }
    });
    if (!b || !b.active) return null;
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      category: b.category,
      city: b.city,
      address: b.address,
      phone: b.phone,
      latitude: b.latitude,
      longitude: b.longitude,
      logoUrl: b.logoUrl,
      brandColor: b.brandColor,
      defaultDiscountPct: b.defaultDiscountPct
    };
  }
  if (banner.kind === "promo" && (banner.promoTitle || banner.promoDescription)) {
    // Ficha sintética: misma forma que un negocio, pero sin comercio real.
    return {
      id: "promo",
      slug: "",
      name: banner.promoTitle || "Promoción Bubui",
      category: banner.promoCategory || "Promoción",
      logoUrl: banner.imageUrl || null,
      brandColor: null,
      discountPct: banner.promoDiscountPct ?? undefined,
      description: banner.promoDescription || null,
      ctaLabel: banner.promoCtaLabel || null,
      ctaLink: banner.promoCtaLink || null,
      isPromo: true
    };
  }
  return null;
}

export async function GET() {
  const manual = await getHomeBanner();
  if (manual.active && manual.imageUrl) {
    const business = await resolveBusiness(manual);
    return NextResponse.json({
      imageUrl: manual.imageUrl,
      active: true,
      // El enlace clásico sólo aplica cuando no hay ficha que abrir.
      link: business ? "" : manual.link,
      ...(business ? { business } : {})
    });
  }
  // Sin banner manual: avanza la cola de campañas y muestra la activa.
  try {
    const campaign = await tickBannerQueue();
    if (campaign?.imageUrl) {
      return NextResponse.json({ imageUrl: campaign.imageUrl, link: campaign.link ?? "", active: true });
    }
  } catch {}
  return NextResponse.json({ imageUrl: "", link: "", active: false });
}
