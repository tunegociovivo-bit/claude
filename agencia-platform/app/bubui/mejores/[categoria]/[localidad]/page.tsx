/**
 * Ranking "Los mejores {sector} de {localidad}".
 *   bubui.app/mejores/peluquerias/benalmadena
 *
 * Posiciona la consulta de alta intención "mejores …" y sirve de gancho
 * comercial. Orden honesto por Puntuación Bubui (ver lib/bubui/rankings.ts).
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getRanking } from "@/lib/bubui/rankings";
import { bubuiUrl } from "@/lib/bubui/url";
import { templateRanking, getStoredIntro } from "@/lib/bubui/editorial";
import Editorial from "../../../_components/Editorial";

export const revalidate = 300;

type Params = { params: { categoria: string; localidad: string } };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const data = await getRanking(params.categoria, params.localidad);
  if (!data) return { title: "Ranking · Bubui" };
  const year = new Date().getFullYear();
  const title = `Las mejores ${data.category.label.toLowerCase()} de ${data.cityLabel} (${year}) · Bubui`;
  const description = `Ranking de las mejores ${data.category.label.toLowerCase()} de ${data.cityLabel} según la Puntuación Bubui (reseñas + actividad). Top ${data.businesses.length} con valoraciones y descuentos.`;
  const canonical = bubuiUrl(`/mejores/${params.categoria}/${params.localidad}`);
  return { title, description, alternates: { canonical }, robots: { index: true, follow: true }, openGraph: { title, description, url: canonical } };
}

const MEDAL = ["🥇", "🥈", "🥉"];

export default async function RankingPage({ params }: Params) {
  const data = await getRanking(params.categoria, params.localidad);
  if (!data) notFound();
  const { category, cityLabel, province, businesses } = data;
  const year = new Date().getFullYear();

  const editorial = templateRanking({ catLabel: category.label, catSingular: category.singular, cityLabel, count: businesses.length, year });
  const storedIntro = await getStoredIntro(`rk:${params.categoria}:${params.localidad}`);
  if (storedIntro) editorial.intro = storedIntro;

  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Las mejores ${category.label.toLowerCase()} de ${cityLabel} (${year})`,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    itemListElement: businesses.map((b) => ({
      "@type": "ListItem",
      position: b.position,
      item: {
        "@type": "LocalBusiness",
        name: b.name,
        url: bubuiUrl(`/n/${b.slug}`),
        address: { "@type": "PostalAddress", addressLocality: cityLabel, addressRegion: province ?? undefined, streetAddress: b.address ?? undefined },
        ...(b.ratingAvg != null && b.ratingCount > 0
          ? { aggregateRating: { "@type": "AggregateRating", ratingValue: b.ratingAvg, reviewCount: b.ratingCount, bestRating: 5, worstRating: 1 } }
          : {})
      }
    }))
  };
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Directorio", item: bubuiUrl("/directorio") },
      { "@type": "ListItem", position: 2, name: category.label, item: bubuiUrl(`/${params.categoria}`) },
      { "@type": "ListItem", position: 3, name: cityLabel, item: bubuiUrl(`/${params.categoria}/${params.localidad}`) },
      { "@type": "ListItem", position: 4, name: "Ranking", item: bubuiUrl(`/mejores/${params.categoria}/${params.localidad}`) }
    ]
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />

      <nav className="max-w-4xl mx-auto px-4 pt-6 text-xs text-slate-500">
        <Link href="/directorio" className="hover:text-pink-600">Directorio</Link>
        <span className="mx-1.5">/</span>
        <Link href={`/${params.categoria}/${params.localidad}`} className="hover:text-pink-600">{category.label} en {cityLabel}</Link>
        <span className="mx-1.5">/</span>
        <span className="text-slate-700">Ranking</span>
      </nav>

      <header className="max-w-4xl mx-auto px-4 pt-4 pb-6">
        <span className="inline-block text-xs font-bold uppercase tracking-wider text-amber-700 bg-amber-100 rounded-full px-3 py-1">🏆 Ranking {year}</span>
        <h1 className="mt-3 text-3xl sm:text-4xl font-black text-slate-900">
          Las mejores {category.label.toLowerCase()} de {cityLabel}
        </h1>
        <p className="mt-2 text-slate-600 max-w-2xl">
          Top {businesses.length} ordenado por la <strong>Puntuación Bubui</strong> (reseñas verificadas + actividad). Orden honesto: la posición no se compra.
        </p>
      </header>

      <ol className="max-w-4xl mx-auto px-4 pb-10 space-y-3">
        {businesses.map((b) => (
          <li key={b.id}>
            <Link
              href={`/n/${b.slug}`}
              className="group flex items-center gap-4 rounded-2xl bg-white border border-slate-200 hover:border-pink-300 hover:shadow-md transition p-4"
            >
              <div className="w-10 shrink-0 text-center">
                {b.position <= 3 ? <span className="text-2xl">{MEDAL[b.position - 1]}</span> : <span className="text-lg font-black text-slate-400">{b.position}</span>}
              </div>
              {b.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.logoUrl} alt={b.name} className="h-14 w-14 rounded-xl object-cover shrink-0" />
              ) : (
                <div className="h-14 w-14 rounded-xl grid place-items-center text-white font-black shrink-0" style={{ background: b.brandColor || "#EC4899" }}>
                  {b.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-slate-900 truncate group-hover:text-pink-600">{b.name}</p>
                  {b.featured && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">Destacado</span>}
                </div>
                <p className="text-xs text-slate-500 truncate">{b.address || cityLabel}</p>
                <p className="mt-1 text-xs text-slate-600">
                  {b.ratingAvg != null ? <>★ {b.ratingAvg.toString().replace(".", ",")} · {b.ratingCount} {b.ratingCount === 1 ? "reseña" : "reseñas"}</> : <span className="text-slate-400">Sin reseñas todavía</span>}
                  {b.defaultDiscountPct > 0 && <span className="text-pink-700"> · hasta {b.defaultDiscountPct}% dto.</span>}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xl font-black text-slate-900">{b.score}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Puntuación</div>
              </div>
            </Link>
          </li>
        ))}
      </ol>

      <Editorial content={editorial} />

      <section className="bg-gradient-to-br from-amber-500 to-pink-600 text-white">
        <div className="max-w-4xl mx-auto px-4 py-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-black">¿Quieres aparecer (y subir) en este ranking?</h2>
          <p className="mt-2 text-white/90 max-w-xl mx-auto">
            Date de alta gratis en Bubui y consigue reseñas de tus clientes: cuantas más y mejores, más sube tu Puntuación Bubui.
          </p>
          <Link href="/registro" className="mt-6 inline-block bg-white text-pink-700 font-bold rounded-full px-6 py-3 hover:bg-pink-50 transition">
            Añadir mi negocio gratis
          </Link>
        </div>
      </section>
    </main>
  );
}
