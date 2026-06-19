/**
 * Página de directorio nicho + localidad.
 *   bubui.app/peluquerias/benalmadena
 *
 * Objetivo SEO: posicionar "peluquerías en Benalmádena" y que el dueño que
 * busca su sector en su pueblo encuentre Bubui arriba, vea la visibilidad
 * del portal y se dé de alta para aparecer aquí.
 *
 * Server component, revalidate 5 min. Si el par no tiene negocios → 404
 * (evita páginas finas que perjudican el SEO).
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getListing, getLocalitiesForCategory } from "@/lib/bubui/directory";
import { bubuiUrl } from "@/lib/bubui/url";
import Editorial from "../../_components/Editorial";
import DirectoryMap from "../../_components/DirectoryMap";
import { templateListing, getStoredIntro, keyListing } from "@/lib/bubui/editorial";

export const revalidate = 300;

type Params = { params: { categoria: string; localidad: string } };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const data = await getListing(params.categoria, params.localidad);
  if (!data) return { title: "Directorio · Bubui" };
  const { category, cityLabel, businesses } = data;
  const title = `${category.label} en ${cityLabel} (${businesses.length}) · Bubui`;
  const description = `Descubre ${businesses.length} ${category.label.toLowerCase()} en ${cityLabel} con descuentos y ofertas en Bubui. El directorio local que da visibilidad a los negocios de ${cityLabel}.`;
  const canonical = bubuiUrl(`/${params.categoria}/${params.localidad}`);
  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: { title, description, url: canonical, type: "website" }
  };
}

export default async function DirectorioNichoLocalidad({ params }: Params) {
  const data = await getListing(params.categoria, params.localidad);
  if (!data) notFound();
  const { category, cityLabel, province, businesses } = data;
  const other = await getLocalitiesForCategory(params.categoria);
  const otherLocalities = (other?.localities ?? []).filter((l) => l.citySlug !== params.localidad).slice(0, 12);

  // Editorial SEO: plantilla extensa + intro IA cacheada si existe.
  const editorial = templateListing({
    catLabel: category.label,
    catSingular: category.singular,
    cityLabel,
    province,
    count: businesses.length,
    names: businesses.map((b) => b.name)
  });
  const storedIntro = await getStoredIntro(keyListing(params.categoria, params.localidad));
  if (storedIntro) editorial.intro = storedIntro;

  // Pines del mapa (negocios con coordenadas).
  const pins = businesses
    .filter((b) => b.latitude != null && b.longitude != null)
    .map((b) => ({ name: b.name, slug: b.slug, lat: b.latitude as number, lng: b.longitude as number }));

  // JSON-LD: lista de negocios para resultados enriquecidos.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${category.label} en ${cityLabel}`,
    itemListElement: businesses.map((b, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "LocalBusiness",
        name: b.name,
        address: { "@type": "PostalAddress", addressLocality: cityLabel, addressRegion: province ?? undefined, streetAddress: b.address ?? undefined },
        url: bubuiUrl(`/n/${b.slug}`)
      }
    }))
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Breadcrumb */}
      <nav className="max-w-5xl mx-auto px-4 pt-6 text-xs text-slate-500">
        <Link href="/directorio" className="hover:text-pink-600">Directorio</Link>
        <span className="mx-1.5">/</span>
        <Link href={`/${params.categoria}`} className="hover:text-pink-600">{category.label}</Link>
        <span className="mx-1.5">/</span>
        <span className="text-slate-700">{cityLabel}</span>
      </nav>

      {/* Hero */}
      <header className="max-w-5xl mx-auto px-4 pt-4 pb-6">
        <h1 className="text-3xl sm:text-4xl font-black text-slate-900">
          {category.label} en {cityLabel}
        </h1>
        <p className="mt-2 text-slate-600 max-w-2xl">
          {businesses.length === 1 ? "1 negocio" : `${businesses.length} negocios`} de tu zona en Bubui, con descuentos y ofertas para sus clientes.
          {province ? ` ${cityLabel}, ${province}.` : ""}
        </p>
      </header>

      {/* Mapa de los negocios con ubicación */}
      {pins.length > 0 && (
        <section className="max-w-5xl mx-auto px-4 pb-8">
          <DirectoryMap pins={pins} />
        </section>
      )}

      {/* Listado */}
      <section className="max-w-5xl mx-auto px-4 pb-10">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {businesses.map((b) => (
            <li key={b.id}>
              <Link
                href={`/n/${b.slug}`}
                className="group block h-full rounded-2xl bg-white border border-slate-200 hover:border-pink-300 hover:shadow-md transition p-5"
              >
                <div className="flex items-center gap-3">
                  {b.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.logoUrl} alt={b.name} className="h-12 w-12 rounded-xl object-cover" />
                  ) : (
                    <div
                      className="h-12 w-12 rounded-xl grid place-items-center text-white font-black"
                      style={{ background: b.brandColor || "#EC4899" }}
                    >
                      {b.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 truncate group-hover:text-pink-600">{b.name}</p>
                    <p className="text-xs text-slate-500 truncate">{b.address || cityLabel}</p>
                  </div>
                </div>
                {b.description && <p className="mt-3 text-sm text-slate-600 line-clamp-2">{b.description}</p>}
                {b.defaultDiscountPct > 0 && (
                  <span className="mt-3 inline-block text-xs font-semibold text-pink-700 bg-pink-50 rounded-full px-2.5 py-1">
                    Hasta {b.defaultDiscountPct}% de descuento
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Editorial SEO (texto extenso + FAQ con schema) */}
      <Editorial content={editorial} />

      {/* CTA captación de negocio (el objetivo del SEO) */}
      <section className="bg-gradient-to-br from-pink-600 to-fuchsia-600 text-white">
        <div className="max-w-5xl mx-auto px-4 py-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-black">
            ¿Tienes {category.singular === "negocio" ? "un negocio" : `${aOrUn(category.singular)} ${category.singular}`} en {cityLabel}?
          </h2>
          <p className="mt-2 text-white/90 max-w-xl mx-auto">
            Aparece en este directorio y consigue más visibilidad y clientes en {cityLabel}. Date de alta en Bubui en 2 minutos, gratis.
          </p>
          <Link
            href="/registro"
            className="mt-6 inline-block bg-white text-pink-700 font-bold rounded-full px-6 py-3 hover:bg-pink-50 transition"
          >
            Añadir mi negocio gratis
          </Link>
        </div>
      </section>

      {/* Enlazado interno: misma categoría en otras localidades */}
      {otherLocalities.length > 0 && (
        <section className="max-w-5xl mx-auto px-4 py-10">
          <h2 className="text-lg font-bold text-slate-900 mb-3">{category.label} en otras localidades</h2>
          <div className="flex flex-wrap gap-2">
            {otherLocalities.map((l) => (
              <Link
                key={l.citySlug}
                href={`/${params.categoria}/${l.citySlug}`}
                className="text-sm rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:border-pink-300 hover:text-pink-600"
              >
                {l.cityLabel} <span className="text-slate-400">({l.count})</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

/** "un/una" según la palabra (heurística simple para el CTA). */
function aOrUn(singular: string): string {
  return /a$/.test(singular) ? "una" : "un";
}
