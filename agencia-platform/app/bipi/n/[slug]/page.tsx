/**
 * Página pública del negocio Bipi.
 *
 *   /bipi/n/<slug>   →   "Spa Bambú — descuentos en Benalmádena · Bipi"
 *
 * Pensada para:
 *   - SEO long-tail: cada negocio = una URL indexable.
 *   - Sharing: el negocio comparte su URL en Instagram, WhatsApp, web.
 *   - Captación de clientes: el visitante ve la oferta y un CTA "Descarga la app y obtén descuento".
 *
 * Server component, cache 5 min. No-blocking si el negocio no existe (404).
 */

import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import type { Metadata } from "next";

export const revalidate = 300;

async function getBusiness(slug: string) {
  return prisma.bubuiBusiness.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      category: true,
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
  if (!b || !b.active) return { title: "Negocio Bipi" };
  return {
    title: `${b.name} · Descuentos en ${b.city} | Bipi`,
    description: `${b.name} en ${b.city} te ofrece un ${b.defaultDiscountPct}% al escanear su QR con la app Bipi. Y desbloqueas descuentos en otros negocios cerca.`,
    openGraph: {
      title: `${b.name} · Bipi`,
      description: `Llévate ${b.defaultDiscountPct}% en ${b.name} (${b.city}) con la app Bipi.`,
      images: [{ url: `/api/bipi/business/${b.id}/poster.png` }]
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

  // JSON-LD para SEO: LocalBusiness + Offer. Google lo usa para rich
  // snippets en búsquedas locales y Maps.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hub.negociovivo.app";
  const businessUrl = `${siteUrl}/bipi/n/${business.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": categoryToSchemaType(business.category),
    name: business.name,
    description: business.description ?? `${business.name} en ${business.city}. Forma parte de la red Bipi: descuentos cruzados entre negocios locales.`,
    url: businessUrl,
    image: `${siteUrl}/api/bipi/business/${business.id}/poster.png`,
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
    makesOffer: {
      "@type": "Offer",
      name: `Descuento Bipi ${business.defaultDiscountPct}%`,
      description: `${business.defaultDiscountPct}% al escanear el QR de ${business.name} con la app Bipi. Y desbloqueas cupones en otros negocios cerca.`,
      url: `${siteUrl}/bipi/scan/${business.id}`,
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <article className="bipi-card overflow-hidden bipi-fade-up">
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
          {business.address && (
            <p className="text-black/50 text-xs mt-1">📍 {business.address}</p>
          )}
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

        {/* CTA principal — Canjear oferta */}
        <div className="px-6 sm:px-8 py-7 mt-6 border-t border-black/5 flex flex-col sm:flex-row gap-3 items-stretch">
          <a href={`/bipi/scan/${business.id}`} className="bipi-btn flex-1 text-center">
            Canjear oferta · {business.defaultDiscountPct}%
          </a>
          <a href="/bipi/app" className="bipi-btn-ghost flex-1 text-center">
            Abrir Bipi
          </a>
        </div>
      </article>

      {/* Cómo funciona */}
      <section className="mt-10 grid sm:grid-cols-3 gap-3 text-sm">
        <Card title="1. Escanea el QR">
          Cuando pagues en {business.name}, escanea su QR con la app Bipi.
        </Card>
        <Card title="2. Llévate el descuento">
          El {business.defaultDiscountPct}% se aplica cuando el negocio confirma tu compra.
        </Card>
        <Card title="3. Desbloquea más">
          Descubres 3-5 cupones en otros negocios de {business.city}. Caducan en 4 días.
        </Card>
      </section>

      {/* Otros negocios */}
      {others.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-bold mb-3">También en {business.city}</h2>
          <ul className="grid sm:grid-cols-2 gap-2">
            {others.map((o) => (
              <li key={o.slug}>
                <a
                  href={`/bipi/n/${o.slug}`}
                  className="bipi-link-card flex items-center justify-between"
                >
                  <div className="min-w-0">
                    <div className="font-bold truncate">{o.name}</div>
                    <div className="text-xs text-black/50 truncate">
                      {o.category}
                    </div>
                  </div>
                  <div className="bipi-discount-big text-2xl ml-2">{o.defaultDiscountPct}%</div>
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
    <div className="bipi-card p-5">
      <div className="font-bold mb-1 text-black">{title}</div>
      <p className="text-black/60 text-sm leading-relaxed">{children}</p>
    </div>
  );
}
