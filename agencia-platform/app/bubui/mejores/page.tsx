/**
 * Índice de rankings.
 *   bubui.app/mejores
 *
 * Lista todos los rankings "los mejores {sector} de {localidad}" disponibles.
 * Reparte autoridad SEO a las páginas de ranking y sirve de navegación.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { getRankingIndex } from "@/lib/bubui/rankings";
import { bubuiUrl } from "@/lib/bubui/url";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const year = new Date().getFullYear();
  const title = `Los mejores negocios locales por sector y ciudad (${year}) · Bubui`;
  const description = "Rankings de los mejores negocios locales por sector y localidad según la Puntuación Bubui: peluquerías, restaurantes, gimnasios y más, con reseñas y descuentos.";
  const canonical = bubuiUrl("/mejores");
  return { title, description, alternates: { canonical }, robots: { index: true, follow: true }, openGraph: { title, description, url: canonical } };
}

export default async function MejoresIndex() {
  const items = await getRankingIndex();
  const year = new Date().getFullYear();

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="max-w-5xl mx-auto px-4 pt-10 pb-6">
        <span className="inline-block text-xs font-bold uppercase tracking-wider text-amber-700 bg-amber-100 rounded-full px-3 py-1">🏆 Rankings {year}</span>
        <h1 className="mt-3 text-3xl sm:text-4xl font-black text-slate-900">Los mejores negocios locales</h1>
        <p className="mt-2 text-slate-600 max-w-2xl">Rankings por sector y localidad según la <strong>Puntuación Bubui</strong> (reseñas verificadas + actividad). Elige el tuyo:</p>
      </header>

      <section className="max-w-5xl mx-auto px-4 pb-12">
        {items.length === 0 ? (
          <p className="text-slate-500 text-sm">
            Aún no hay rankings disponibles (se crean cuando un sector tiene varios negocios en una localidad).{" "}
            <Link href="/registro" className="text-pink-600 underline">Da de alta tu negocio.</Link>
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => (
              <Link
                key={`${p.catSlug}/${p.citySlug}`}
                href={`/mejores/${p.catSlug}/${p.citySlug}`}
                className="flex items-center justify-between rounded-xl bg-white border border-slate-200 hover:border-amber-300 hover:shadow-sm transition px-4 py-2.5"
              >
                <span className="text-sm text-slate-800">Mejores {p.catLabel.toLowerCase()} de {p.cityLabel}</span>
                <span className="text-xs text-slate-400 shrink-0 ml-2">{p.count}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="bg-gradient-to-br from-amber-500 to-pink-600 text-white">
        <div className="max-w-5xl mx-auto px-4 py-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-black">¿Quieres salir en los rankings de tu zona?</h2>
          <p className="mt-2 text-white/90 max-w-xl mx-auto">Date de alta gratis en Bubui y consigue reseñas: cuantas más y mejores, más sube tu Puntuación Bubui.</p>
          <Link href="/registro" className="mt-6 inline-block bg-white text-pink-700 font-bold rounded-full px-6 py-3 hover:bg-pink-50 transition">
            Añadir mi negocio gratis
          </Link>
        </div>
      </section>
    </main>
  );
}
