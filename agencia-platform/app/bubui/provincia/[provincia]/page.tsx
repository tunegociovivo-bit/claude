/**
 * Página de provincia del directorio.
 *   bubui.app/provincia/malaga
 *
 * Agrupa las localidades de una provincia con negocios en Bubui. Va en su
 * propia ruta (/provincia/…) para no chocar con los slugs de sector/localidad
 * (Málaga es a la vez ciudad y provincia).
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getLocalitiesForProvince } from "@/lib/bubui/directory";
import { bubuiUrl } from "@/lib/bubui/url";

export const revalidate = 300;

type Params = { params: { provincia: string } };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const data = await getLocalitiesForProvince(params.provincia);
  if (!data) return { title: "Directorio · Bubui" };
  const title = `Negocios con descuentos en ${data.provLabel} · Bubui`;
  const description = `Descubre negocios locales con descuentos en la provincia de ${data.provLabel}: ${data.localities.slice(0, 6).map((l) => l.cityLabel).join(", ")} y más. Directorio Bubui.`;
  const canonical = bubuiUrl(`/provincia/${params.provincia}`);
  return { title, description, alternates: { canonical }, robots: { index: true, follow: true }, openGraph: { title, description, url: canonical } };
}

export default async function ProvinciaPage({ params }: Params) {
  const data = await getLocalitiesForProvince(params.provincia);
  if (!data) notFound();
  const { provLabel, total, localities } = data;

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Directorio", item: bubuiUrl("/directorio") },
      { "@type": "ListItem", position: 2, name: provLabel, item: bubuiUrl(`/provincia/${params.provincia}`) }
    ]
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />

      <nav className="max-w-5xl mx-auto px-4 pt-6 text-xs text-slate-500">
        <Link href="/directorio" className="hover:text-pink-600">Directorio</Link>
        <span className="mx-1.5">/</span>
        <span className="text-slate-700">{provLabel}</span>
      </nav>

      <header className="max-w-5xl mx-auto px-4 pt-4 pb-6">
        <h1 className="text-3xl sm:text-4xl font-black text-slate-900">Negocios en {provLabel}</h1>
        <p className="mt-2 text-slate-600 max-w-2xl">
          {total === 1 ? "1 negocio" : `${total} negocios`} de la provincia de {provLabel} con descuentos en Bubui, repartidos en {localities.length === 1 ? "1 localidad" : `${localities.length} localidades`}. Elige tu pueblo o ciudad:
        </p>
      </header>

      <section className="max-w-5xl mx-auto px-4 pb-12">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {localities.map((l) => (
            <Link key={l.citySlug} href={`/${l.citySlug}`} className="flex items-center justify-between rounded-xl bg-white border border-slate-200 hover:border-pink-300 hover:shadow-sm transition px-4 py-3">
              <span className="font-semibold text-slate-800">{l.cityLabel}</span>
              <span className="text-xs text-slate-400">{l.count}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-gradient-to-br from-pink-600 to-fuchsia-600 text-white">
        <div className="max-w-5xl mx-auto px-4 py-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-black">¿Tienes un negocio en {provLabel}?</h2>
          <p className="mt-2 text-white/90 max-w-xl mx-auto">Date de alta gratis en Bubui y aparece en el directorio de tu localidad.</p>
          <Link href="/registro" className="mt-6 inline-block bg-white text-pink-700 font-bold rounded-full px-6 py-3 hover:bg-pink-50 transition">
            Añadir mi negocio gratis
          </Link>
        </div>
      </section>
    </main>
  );
}
