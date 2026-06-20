/**
 * Índice del directorio Bubui.
 *   bubui.app/directorio
 *
 * Enlaza a todas las categorías y a los pares nicho+localidad con negocios.
 * Es el hub de enlazado interno que reparte autoridad SEO a las páginas hoja.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { getDirectoryIndex, getAllLocalities, getAllProvinces } from "@/lib/bubui/directory";
import { bubuiUrl } from "@/lib/bubui/url";
import DirectorySearch from "../_components/DirectorySearch";

// Dinámica: consulta la BD en cada petición (no en build). Evita depender de
// la BD al compilar y refleja altas nuevas al instante.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const title = "Directorio de negocios locales con descuentos · Bubui";
  const description = "Explora negocios locales por sector y localidad: peluquerías, restaurantes, gimnasios, estética y más, con descuentos y ofertas en Bubui.";
  const canonical = bubuiUrl("/directorio");
  return { title, description, alternates: { canonical }, robots: { index: true, follow: true }, openGraph: { title, description, url: canonical } };
}

export default async function DirectorioIndex() {
  const [{ pairs, categories }, localities, provinces] = await Promise.all([getDirectoryIndex(), getAllLocalities(), getAllProvinces()]);

  const searchItems = [
    ...categories.map((c) => ({ label: c.catLabel, href: `/${c.catSlug}` })),
    ...localities.map((l) => ({ label: l.cityLabel, href: `/${l.citySlug}` })),
    ...pairs.map((p) => ({ label: `${p.catLabel} en ${p.cityLabel}`, href: `/${p.catSlug}/${p.citySlug}` }))
  ];

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="max-w-5xl mx-auto px-4 pt-10 pb-6">
        <h1 className="text-3xl sm:text-4xl font-black text-slate-900">Directorio de negocios locales</h1>
        <p className="mt-2 text-slate-600 max-w-2xl">Negocios de tu zona con descuentos y ofertas en Bubui. Elige tu sector y tu localidad.</p>
        {searchItems.length > 0 && (
          <div className="mt-5 max-w-xl">
            <DirectorySearch items={searchItems} />
          </div>
        )}
      </header>

      {/* Categorías */}
      <section className="max-w-5xl mx-auto px-4 pb-8">
        <h2 className="text-lg font-bold text-slate-900 mb-3">Por sector</h2>
        {categories.length === 0 ? (
          <p className="text-slate-500 text-sm">Aún no hay negocios dados de alta. <Link href="/registro" className="text-pink-600 underline">Sé el primero.</Link></p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <Link key={c.catSlug} href={`/${c.catSlug}`} className="text-sm rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:border-pink-300 hover:text-pink-600">
                {c.catLabel} <span className="text-slate-400">({c.count})</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Provincias */}
      {provinces.length > 0 && (
        <section className="max-w-5xl mx-auto px-4 pb-8">
          <h2 className="text-lg font-bold text-slate-900 mb-3">Por provincia</h2>
          <div className="flex flex-wrap gap-2">
            {provinces.map((p) => (
              <Link key={p.provSlug} href={`/provincia/${p.provSlug}`} className="text-sm rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:border-pink-300 hover:text-pink-600">
                {p.provLabel} <span className="text-slate-400">({p.count})</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Localidades */}
      {localities.length > 0 && (
        <section className="max-w-5xl mx-auto px-4 pb-8">
          <h2 className="text-lg font-bold text-slate-900 mb-3">Por localidad</h2>
          <div className="flex flex-wrap gap-2">
            {localities.map((l) => (
              <Link key={l.citySlug} href={`/${l.citySlug}`} className="text-sm rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:border-pink-300 hover:text-pink-600">
                {l.cityLabel} <span className="text-slate-400">({l.count})</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Pares nicho+localidad */}
      {pairs.length > 0 && (
        <section className="max-w-5xl mx-auto px-4 pb-12">
          <h2 className="text-lg font-bold text-slate-900 mb-3">Por sector y localidad</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {pairs.map((p) => (
              <Link
                key={`${p.catSlug}/${p.citySlug}`}
                href={`/${p.catSlug}/${p.citySlug}`}
                className="flex items-center justify-between rounded-xl bg-white border border-slate-200 hover:border-pink-300 hover:shadow-sm transition px-4 py-2.5"
              >
                <span className="text-sm text-slate-800">{p.catLabel} en {p.cityLabel}</span>
                <span className="text-xs text-slate-400">{p.count}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="bg-gradient-to-br from-pink-600 to-fuchsia-600 text-white">
        <div className="max-w-5xl mx-auto px-4 py-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-black">Pon tu negocio en el mapa</h2>
          <p className="mt-2 text-white/90 max-w-xl mx-auto">Date de alta gratis en Bubui y aparece en el directorio de tu sector y tu localidad.</p>
          <Link href="/registro" className="mt-6 inline-block bg-white text-pink-700 font-bold rounded-full px-6 py-3 hover:bg-pink-50 transition">
            Añadir mi negocio gratis
          </Link>
        </div>
      </section>
    </main>
  );
}
