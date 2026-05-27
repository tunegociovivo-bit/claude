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
      <article className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        {/* Hero */}
        <div
          className="px-8 py-12 text-center"
          style={{ background: business.brandColor ?? "#FDF2E1" }}
        >
          {business.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={business.logoUrl}
              alt={business.name}
              className="h-20 w-20 mx-auto mb-4 rounded-full bg-white object-cover border-4 border-white shadow"
            />
          )}
          <h1 className="text-4xl font-bold text-slate-900">{business.name}</h1>
          <p className="text-slate-700 mt-2">
            {business.category} · {business.city}
          </p>
          {business.address && (
            <p className="text-slate-600 text-sm mt-1">📍 {business.address}</p>
          )}
        </div>

        {/* Oferta */}
        <div className="px-8 py-8 text-center">
          <p className="text-sm text-slate-500 uppercase tracking-wide">Descuento al escanear</p>
          <p className="text-7xl font-black text-amber-600">{business.defaultDiscountPct}%</p>
          <p className="text-sm text-slate-600 mt-2">
            Llévate el descuento con la app Bipi al pagar
          </p>
        </div>

        {/* Descripción */}
        {business.description && (
          <div className="px-8 pb-6 text-slate-700 whitespace-pre-wrap">
            {business.description}
          </div>
        )}

        {/* CTAs */}
        <div className="px-8 pb-8 flex flex-col sm:flex-row gap-3 items-stretch">
          <a
            href="/bipi/app"
            className="flex-1 text-center bg-amber-600 hover:bg-amber-700 text-white font-medium py-3 rounded-full"
          >
            📲 Abrir Bipi
          </a>
          <a
            href={`/bipi/scan/${business.id}`}
            className="flex-1 text-center bg-slate-900 hover:bg-slate-800 text-white font-medium py-3 rounded-full"
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
                  className="block bg-white border rounded-xl p-3 hover:bg-slate-50"
                >
                  <div className="font-medium">{o.name}</div>
                  <div className="text-xs text-slate-500">
                    {o.category} · {o.defaultDiscountPct}% al escanear
                  </div>
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
    <div className="bg-white rounded-xl border p-4">
      <div className="font-semibold mb-1">{title}</div>
      <p className="text-slate-700 text-sm">{children}</p>
    </div>
  );
}
