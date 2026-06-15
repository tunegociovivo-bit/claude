/**
 * Página pública del negocio Bubui.
 *
 *   /bubui/n/<slug>   →   "Spa Bambú — descuentos en Benalmádena · Bubui"
 *
 * Pensada para:
 *   - SEO long-tail: cada negocio = una URL indexable.
 *   - Sharing: el negocio comparte su URL en Instagram, WhatsApp, web.
 *   - Captación de clientes: el visitante ve la oferta y un CTA "Descarga la app y obtén descuento".
 *
 * Server component, cache 5 min. No-blocking si el negocio no existe (404).
 */

import { notFound } from "next/navigation";
import { Suspense } from "react";
import { prisma } from "@/lib/db/prisma";
import type { Metadata } from "next";
import ReviewForm from "./ReviewForm";
import BookingForm from "./BookingForm";
import RefCapture from "./RefCapture";
import { getTopPosition } from "@/lib/bubui/topcategory";

export const revalidate = 300;

async function getReviews(businessId: string) {
  const [agg, list] = await Promise.all([
    prisma.bubuiReview.aggregate({
      where: { businessId },
      _avg: { rating: true },
      _count: true
    }),
    prisma.bubuiReview.findMany({
      where: { businessId, comment: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { customer: { select: { name: true } } }
    })
  ]);
  return {
    count: agg._count,
    average: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : null,
    list: list.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      author: r.customer?.name || "Cliente Bubui",
      createdAt: r.createdAt
    }))
  };
}

function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span style={{ fontSize: size, color: "#F59E0B", letterSpacing: 1 }}>
      {"★".repeat(Math.round(value))}
      <span style={{ color: "#D1D5DB" }}>{"★".repeat(5 - Math.round(value))}</span>
    </span>
  );
}

async function getBusiness(slug: string) {
  return prisma.bubuiBusiness.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      category: true,
      businessType: true,
      bookingEnabled: true,
      description: true,
      city: true,
      province: true,
      address: true,
      latitude: true,
      longitude: true,
      logoUrl: true,
      brandColor: true,
      defaultDiscountPct: true,
      crossDiscountPct: true,
      reviewRewardPct: true,
      googlePlaceId: true,
      visibilityScore: true,
      active: true,
      createdAt: true
    }
  });
}

/** Mapea categoría libre a un tipo de schema.org adecuado. */
function categoryToSchemaType(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("restaur")) return "Restaurant";
  if (c.includes("café") || c.includes("cafe") || c.includes("bar")) return "CafeOrCoffeeShop";
  if (c.includes("peluqu") || c.includes("barber") || c.includes("estét") || c.includes("estet") || c.includes("spa")) return "BeautySalon";
  if (c.includes("gimnasio") || c.includes("fitness")) return "ExerciseGym";
  if (c.includes("nutric") || c.includes("salud")) return "HealthAndBeautyBusiness";
  if (c.includes("joy")) return "JewelryStore";
  if (c.includes("flor")) return "Florist";
  if (c.includes("tienda") || c.includes("moda") || c.includes("regalo")) return "Store";
  return "LocalBusiness";
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const b = await getBusiness(params.slug);
  if (!b || !b.active) return { title: "Negocio Bubui" };
  return {
    title: `${b.name} · Descuentos en ${b.city} | Bubui`,
    description: `${b.name} en ${b.city} te ofrece un ${b.defaultDiscountPct}% al escanear su QR con la app Bubui. Y desbloqueas descuentos en otros negocios cerca.`,
    openGraph: {
      title: `${b.name} · Bubui`,
      description: `Llévate ${b.defaultDiscountPct}% en ${b.name} (${b.city}) con la app Bubui.`,
      images: [{ url: `/api/bubui/business/${b.id}/poster.png` }]
    }
  };
}

export default async function BusinessPublicPage({ params }: { params: { slug: string } }) {
  const business = await getBusiness(params.slug);
  if (!business || !business.active) notFound();

  // Otros negocios populares de la red en la misma ciudad (descubrimiento).
  const others = await prisma.bubuiBusiness.findMany({
    where: { city: business.city, active: true, id: { not: business.id } },
    orderBy: { visibilityScore: "desc" },
    take: 6,
    select: { slug: true, name: true, category: true, defaultDiscountPct: true }
  });

  const reviews = await getReviews(business.id);

  // Catálogo (comercios de producto): productos activos para mostrar en la ficha.
  const products =
    (business as any).businessType === "comercio_producto"
      ? await prisma.bubuiProduct.findMany({
          where: { businessId: business.id, active: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
          take: 60,
          select: { id: true, name: true, description: true, priceEur: true, imageUrl: true }
        })
      : [];

  // Servicios para el formulario de cita: solo en negocios de tipo "servicios"
  // con las reservas activadas. (Si cambian el tipo, la cita deja de mostrarse
  // aunque queden servicios o bookingEnabled de cuando era "servicios".)
  const showBooking = (business as any).bookingEnabled && (business as any).businessType === "servicios";
  const services = showBooking
    ? await prisma.bubuiService.findMany({
        where: { businessId: business.id, active: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, durationMin: true, unit: true, priceEur: true }
      })
    : [];

  const topPosition = await getTopPosition({
    businessId: business.id,
    city: business.city,
    category: business.category
  });

  // JSON-LD para SEO: LocalBusiness + Offer. Google lo usa para rich
  // snippets en búsquedas locales y Maps.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hub.negociovivo.app";
  const businessUrl = `${siteUrl}/bubui/n/${business.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": categoryToSchemaType(business.category),
    name: business.name,
    description: business.description ?? `${business.name} en ${business.city}. Forma parte de la red Bubui: descuentos cruzados entre negocios locales.`,
    url: businessUrl,
    image: `${siteUrl}/api/bubui/business/${business.id}/poster.png`,
    ...(business.address || business.city
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: business.address ?? undefined,
            addressLocality: business.city,
            addressRegion: business.province ?? undefined,
            addressCountry: "ES"
          }
        }
      : {}),
    ...(business.latitude != null && business.longitude != null
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: business.latitude,
            longitude: business.longitude
          }
        }
      : {}),
    ...(reviews.average != null && reviews.count > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: reviews.average,
            reviewCount: reviews.count,
            bestRating: 5,
            worstRating: 1
          }
        }
      : {}),
    makesOffer: {
      "@type": "Offer",
      name: `Descuento Bubui ${business.defaultDiscountPct}%`,
      description: `${business.defaultDiscountPct}% al escanear el QR de ${business.name} con la app Bubui. Y desbloqueas cupones en otros negocios cerca.`,
      url: `${siteUrl}/bubui/scan/${business.id}`,
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        priceCurrency: "EUR",
        price: 0,
        valueAddedTaxIncluded: true
      },
      availability: "https://schema.org/InStock"
    }
  };

  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <Suspense fallback={null}>
        <RefCapture />
      </Suspense>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <article className="bubui-card overflow-hidden bubui-fade-up">
        {/* Photo hero — estilo mockup */}
        <div
          className="relative"
          style={{
            aspectRatio: "16 / 9",
            background:
              business.logoUrl
                ? `center/cover no-repeat url(${business.logoUrl})`
                : (business.brandColor ?? "linear-gradient(135deg, #FDF2F8 0%, #FCE7F3 100%)")
          }}
        >
          {/* Discount tag flotante arriba-derecha */}
          <div
            className="absolute top-4 right-4 text-white font-black px-4 py-2 rounded-full text-base shadow-lg"
            style={{ background: "linear-gradient(135deg, #EC4899, #DB2777)" }}
          >
            -{business.defaultDiscountPct}%
          </div>
          {/* Overlay para legibilidad si hay foto */}
          {business.logoUrl && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          )}
        </div>

        {/* Datos del negocio */}
        <div className="px-6 sm:px-8 pt-6">
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-black">{business.name}</h1>
          <p className="text-black/55 mt-1 text-sm font-semibold">
            {business.category} · {business.city}
          </p>
          {topPosition != null && (
            <div className="inline-flex items-center gap-1.5 mt-2 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-gradient-to-r from-amber-100 to-pink-100 text-amber-800 border border-amber-300">
              <span>🏆</span>
              Top {topPosition} en {business.category.toLowerCase()} · {business.city}
            </div>
          )}
          {business.address && (
            <p className="text-black/50 text-xs mt-1">📍 {business.address}</p>
          )}
        </div>

        {/* Oferta destacada */}
        <div className="px-6 sm:px-8 pt-5">
          <div className="flex items-center gap-3 rounded-2xl bg-pink-50 border border-pink-100 px-4 py-3">
            <div className="text-2xl font-black text-pink-600">-{business.defaultDiscountPct}%</div>
            <div className="text-sm font-semibold text-black/75">
              Descuento al escanear su QR con Bubui
            </div>
          </div>
        </div>

        {/* Sobre nosotros */}
        {business.description && (
          <div className="px-6 sm:px-8 pt-6">
            <div className="text-xs font-bold uppercase tracking-wider text-black/45 mb-2">Sobre nosotros</div>
            <p className="text-black/75 whitespace-pre-wrap leading-relaxed text-sm">
              {business.description}
            </p>
          </div>
        )}

        {/* Catálogo de productos (comercios de producto) */}
        {products.length > 0 && (
          <div className="px-6 sm:px-8 pt-6">
            <div className="text-xs font-bold uppercase tracking-wider text-black/45 mb-2">Catálogo</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {products.map((p) => (
                <div key={p.id} className="rounded-xl border overflow-hidden bg-white">
                  {p.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt={p.name} className="w-full h-28 object-cover" />
                  )}
                  <div className="p-2">
                    <div className="text-sm font-semibold leading-tight">{p.name}</div>
                    {p.description && <div className="text-[11px] text-black/55 mt-0.5 line-clamp-2">{p.description}</div>}
                    {p.priceEur != null && <div className="text-sm font-black text-pink-600 mt-1">{p.priceEur}€</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pedir cita (solo negocios de tipo "servicios" con reservas activas) */}
        {showBooking && (
          <div className="px-6 sm:px-8 pt-6">
            <div className="text-xs font-bold uppercase tracking-wider text-black/45 mb-2">Pedir cita</div>
            <BookingForm businessId={business.id} services={services} />
          </div>
        )}

        {/* Mapa (si hay coordenadas) */}
        {business.latitude != null && business.longitude != null && (
          <div className="px-6 sm:px-8 pt-6">
            <div className="text-xs font-bold uppercase tracking-wider text-black/45 mb-2">Dónde estamos</div>
            <div className="rounded-2xl overflow-hidden border border-black/10">
              <iframe
                title="Mapa"
                width="100%"
                height="200"
                loading="lazy"
                style={{ border: 0, display: "block" }}
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${business.longitude - 0.004}%2C${business.latitude - 0.003}%2C${business.longitude + 0.004}%2C${business.latitude + 0.003}&layer=mapnik&marker=${business.latitude}%2C${business.longitude}`}
              />
            </div>
            {business.address && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${business.latitude},${business.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-pink-600 font-semibold mt-2 inline-block hover:underline"
              >
                📍 {business.address} · Cómo llegar →
              </a>
            )}
          </div>
        )}

        {/* CTA principal — Canjear oferta */}
        <div className="px-6 sm:px-8 py-7 mt-6 border-t border-black/5">
          <a href={`/bubui/scan/${business.id}`} className="bubui-btn w-full text-center block">
            Canjear oferta · {business.defaultDiscountPct}%
          </a>
        </div>
      </article>

      {/* Cómo funciona */}
      <section className="mt-10 grid sm:grid-cols-3 gap-3 text-sm">
        <Card title="1. Escanea el QR">
          Cuando pagues en {business.name}, escanea su QR con la app Bubui.
        </Card>
        <Card title="2. Llévate el descuento">
          El {business.defaultDiscountPct}% se aplica cuando el negocio confirma tu compra.
        </Card>
        <Card title="3. Desbloquea más">
          Descubres 3-5 cupones en otros negocios de {business.city}. Caducan en 4 días.
        </Card>
      </section>

      {/* Valoraciones */}
      <section className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">Valoraciones</h2>
          {reviews.average != null && (
            <div className="flex items-center gap-2 text-sm">
              <Stars value={reviews.average} />
              <span className="font-bold">{reviews.average}</span>
              <span className="text-black/45">({reviews.count})</span>
            </div>
          )}
        </div>
        {reviews.list.length > 0 ? (
          <ul className="space-y-2">
            {reviews.list.map((r) => (
              <li key={r.id} className="bubui-card p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">{r.author}</span>
                  <Stars value={r.rating} size={14} />
                </div>
                {r.comment && <p className="text-sm text-black/70 mt-1 whitespace-pre-wrap">{r.comment}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-black/45">Aún no hay valoraciones. ¡Sé el primero!</p>
        )}
        <ReviewForm
          businessId={business.id}
          reviewRewardPct={business.reviewRewardPct ?? 0}
          googlePlaceId={business.googlePlaceId ?? null}
          businessName={business.name}
        />
      </section>

      {/* Otros negocios */}
      {others.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-bold mb-3">También en {business.city}</h2>
          <ul className="grid sm:grid-cols-2 gap-2">
            {others.map((o) => (
              <li key={o.slug}>
                <a
                  href={`/bubui/n/${o.slug}`}
                  className="bubui-link-card flex items-center justify-between"
                >
                  <div className="min-w-0">
                    <div className="font-bold truncate">{o.name}</div>
                    <div className="text-xs text-black/50 truncate">
                      {o.category}
                    </div>
                  </div>
                  <div className="bubui-discount-big text-2xl ml-2">{o.defaultDiscountPct}%</div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bubui-card p-5">
      <div className="font-bold mb-1 text-black">{title}</div>
      <p className="text-black/60 text-sm leading-relaxed">{children}</p>
    </div>
  );
}
