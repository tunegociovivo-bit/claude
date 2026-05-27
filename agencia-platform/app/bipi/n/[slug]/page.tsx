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
  return prisma.bipiBusiness.findUnique({
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
  const others = await prisma.bipiBusiness.findMany({
    where: { city: business.city, active: true, id: { not: business.id } },
    orderBy: { visibilityScore: "desc" },
    take: 6,
    select: { slug: true, name: true, category: true, defaultDiscountPct: true }
  });

  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <article className="bipi-card overflow-hidden bipi-fade-up">
        {/* Hero */}
        <div
          className="px-8 py-14 text-center relative overflow-hidden"
          style={{
            background:
              business.brandColor ??
              "linear-gradient(135deg, #FDF2F8 0%, #FCE7F3 100%)"
          }}
        >
          <div className="absolute -top-12 -right-12 w-48 h-48 bg-pink-500/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -left-12 w-48 h-48 bg-pink-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="relative">
            {business.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={business.logoUrl}
                alt={business.name}
                className="h-24 w-24 mx-auto mb-5 rounded-full bg-white object-cover border-4 border-white shadow-xl"
              />
            ) : (
              <div className="h-24 w-24 mx-auto mb-5 rounded-full bg-black grid place-items-center text-white text-3xl font-black border-4 border-white shadow-xl">
                {business.name.charAt(0)}
              </div>
            )}
            <h1 className="text-5xl font-black tracking-tight text-black">{business.name}</h1>
            <p className="text-black/60 mt-2 font-medium">
              {business.category} · {business.city}
            </p>
            {business.address && (
              <p className="text-black/50 text-sm mt-1">📍 {business.address}</p>
            )}
          </div>
        </div>

        {/* Oferta */}
        <div className="px-8 py-10 text-center bg-white">
          <p className="bipi-eyebrow">Descuento al escanear</p>
          <p className="bipi-discount-big mt-4" style={{ fontSize: "8rem" }}>
            {business.defaultDiscountPct}%
          </p>
          <p className="text-sm text-black/60 mt-2">
            Llévate el descuento con la app Bipi al pagar
          </p>
        </div>

        {/* Descripción */}
        {business.description && (
          <div className="px-8 pb-8 text-black/70 whitespace-pre-wrap leading-relaxed">
            {business.description}
          </div>
        )}

        {/* CTAs */}
        <div className="px-8 pb-10 flex flex-col sm:flex-row gap-3 items-stretch">
          <a href="/bipi/app" className="bipi-btn flex-1 text-center">
            📲 Abrir Bipi
          </a>
          <a
            href={`/bipi/scan/${business.id}`}
            className="bipi-btn-ghost flex-1 text-center"
          >
            🎟 Quiero el descuento ya
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
