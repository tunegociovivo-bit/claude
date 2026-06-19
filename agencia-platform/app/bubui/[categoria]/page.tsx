/**
 * Página de categoría del directorio (localidades donde hay ese nicho).
 *   bubui.app/peluquerias
 *
 * Mejora la profundidad de rastreo (enlaza a cada nicho+localidad) y
 * posiciona la consulta genérica del sector.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getLocalitiesForCategory } from "@/lib/bubui/directory";
import { bubuiUrl } from "@/lib/bubui/url";

export const revalidate = 300;

type Params = { params: { categoria: string } };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const data = await getLocalitiesForCategory(params.categoria);
  if (!data) return { title: "Directorio · Bubui" };
  const title = `${data.category.label} cerca de ti · Bubui`;
  const description = `Encuentra ${data.category.label.toLowerCase()} con descuentos en tu localidad. Directorio Bubui de negocios locales.`;
  const canonical = bubuiUrl(`/${params.categoria}`);
  return { title, description, alternates: { canonical }, robots: { index: true, follow: true }, openGraph: { title, description, url: canonical } };
}

export default async function CategoriaPage({ params }: Params) {
  const data = await getLocalitiesForCategory(params.categoria);
  if (!data) notFound();
  const { category, localities } = data;

  return (
    <main className="min-h-screen bg-slate-50">
      <nav className="max-w-5xl mx-auto px-4 pt-6 text-xs text-slate-500">
        <Link href="/directorio" className="hover:text-pink-600">Directorio</Link>
        <span className="mx-1.5">/</span>
        <span className="text-slate-700">{category.label}</span>
      </nav>

      <header className="max-w-5xl mx-auto px-4 pt-4 pb-6">
        <h1 className="text-3xl sm:text-4xl font-black text-slate-900">{category.label}</h1>
        <p className="mt-2 text-slate-600 max-w-2xl">Elige tu localidad para ver {category.label.toLowerCase()} con descuentos en Bubui.</p>
      </header>

      <section className="max-w-5xl mx-auto px-4 pb-12">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {localities.map((l) => (
            <Link
              key={l.citySlug}
              href={`/${params.categoria}/${l.citySlug}`}
              className="flex items-center justify-between rounded-xl bg-white border border-slate-200 hover:border-pink-300 hover:shadow-sm transition px-4 py-3"
            >
              <span className="font-semibold text-slate-800">{l.cityLabel}</span>
              <span className="text-xs text-slate-400">{l.count}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-gradient-to-br from-pink-600 to-fuchsia-600 text-white">
        <div className="max-w-5xl mx-auto px-4 py-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-black">¿Tu negocio no está todavía?</h2>
          <p className="mt-2 text-white/90 max-w-xl mx-auto">Date de alta gratis y aparece en el directorio de tu localidad.</p>
          <Link href="/registro" className="mt-6 inline-block bg-white text-pink-700 font-bold rounded-full px-6 py-3 hover:bg-pink-50 transition">
            Añadir mi negocio gratis
          </Link>
        </div>
      </section>
    </main>
  );
}
