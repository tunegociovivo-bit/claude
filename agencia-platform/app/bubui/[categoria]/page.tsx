/**
 * Ruta de un segmento del directorio. Sirve DOS tipos de página según el slug
 * (no se pueden tener dos rutas dinámicas hermanas, así que decide aquí):
 *   bubui.app/peluquerias   → sector: localidades donde hay ese nicho
 *   bubui.app/benalmadena   → localidad: sectores con negocios en ese pueblo
 *
 * Los slugs de sector son un conjunto cerrado (taxonomía); cualquier otro slug
 * se intenta como localidad. Si no es ninguno → 404.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { categoryBySlug, getLocalitiesForCategory, getCategoriesForLocality } from "@/lib/bubui/directory";
import { bubuiUrl } from "@/lib/bubui/url";
import Editorial from "../_components/Editorial";
import DirectoryMap from "../_components/DirectoryMap";
import { templateCategory, templateLocality, getStoredIntro, keyCategory, keyLocality } from "@/lib/bubui/editorial";

export const revalidate = 300;

type Params = { params: { categoria: string } };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const slug = params.categoria;
  if (categoryBySlug(slug)) {
    const data = await getLocalitiesForCategory(slug);
    if (!data) return { title: "Directorio · Bubui" };
    const title = `${data.category.label} cerca de ti · Bubui`;
    const description = `Encuentra ${data.category.label.toLowerCase()} con descuentos en tu localidad. Directorio Bubui de negocios locales.`;
    const canonical = bubuiUrl(`/${slug}`);
    return { title, description, alternates: { canonical }, robots: { index: true, follow: true }, openGraph: { title, description, url: canonical } };
  }
  const loc = await getCategoriesForLocality(slug);
  if (!loc) return { title: "Directorio · Bubui" };
  const title = `Negocios con descuentos en ${loc.cityLabel} · Bubui`;
  const description = `Descubre ${loc.total} negocios de ${loc.cityLabel} con descuentos y ofertas en Bubui: ${loc.categories.slice(0, 4).map((c) => c.catLabel.toLowerCase()).join(", ")} y más.`;
  const canonical = bubuiUrl(`/${slug}`);
  return { title, description, alternates: { canonical }, robots: { index: true, follow: true }, openGraph: { title, description, url: canonical } };
}

export default async function SegmentoPage({ params }: Params) {
  const slug = params.categoria;

  // ── Caso sector (/peluquerias) ──────────────────────────────────────────
  if (categoryBySlug(slug)) {
    const data = await getLocalitiesForCategory(slug);
    if (!data) notFound();
    const { category, localities } = data;
    const editorial = templateCategory({ catLabel: category.label, catSingular: category.singular, cityCount: localities.length });
    const storedIntro = await getStoredIntro(keyCategory(slug));
    if (storedIntro) editorial.intro = storedIntro;
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
              <Link key={l.citySlug} href={`/${slug}/${l.citySlug}`} className="flex items-center justify-between rounded-xl bg-white border border-slate-200 hover:border-pink-300 hover:shadow-sm transition px-4 py-3">
                <span className="font-semibold text-slate-800">{l.cityLabel}</span>
                <span className="text-xs text-slate-400">{l.count}</span>
              </Link>
            ))}
          </div>
        </section>
        <Editorial content={editorial} />
        <CtaAlta titulo="¿Tu negocio no está todavía?" sub="Date de alta gratis y aparece en el directorio de tu localidad." />
      </main>
    );
  }

  // ── Caso localidad (/benalmadena) ───────────────────────────────────────
  const loc = await getCategoriesForLocality(slug);
  if (!loc) notFound();
  const editorialLoc = templateLocality({ cityLabel: loc.cityLabel, province: loc.province, total: loc.total, catLabels: loc.categories.map((c) => c.catLabel) });
  const storedIntroLoc = await getStoredIntro(keyLocality(slug));
  if (storedIntroLoc) editorialLoc.intro = storedIntroLoc;
  return (
    <main className="min-h-screen bg-slate-50">
      <nav className="max-w-5xl mx-auto px-4 pt-6 text-xs text-slate-500">
        <Link href="/directorio" className="hover:text-pink-600">Directorio</Link>
        <span className="mx-1.5">/</span>
        <span className="text-slate-700">{loc.cityLabel}</span>
      </nav>
      <header className="max-w-5xl mx-auto px-4 pt-4 pb-6">
        <h1 className="text-3xl sm:text-4xl font-black text-slate-900">Negocios en {loc.cityLabel}</h1>
        <p className="mt-2 text-slate-600 max-w-2xl">
          {loc.total === 1 ? "1 negocio" : `${loc.total} negocios`} de {loc.cityLabel} con descuentos en Bubui{loc.province ? `, ${loc.province}` : ""}. Elige un sector:
        </p>
      </header>
      {loc.pins.length > 0 && (
        <section className="max-w-5xl mx-auto px-4 pb-8">
          <DirectoryMap pins={loc.pins} />
        </section>
      )}
      <section className="max-w-5xl mx-auto px-4 pb-12">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {loc.categories.map((c) => (
            <Link key={c.catSlug} href={`/${c.catSlug}/${slug}`} className="flex items-center justify-between rounded-xl bg-white border border-slate-200 hover:border-pink-300 hover:shadow-sm transition px-4 py-3">
              <span className="font-semibold text-slate-800">{c.catLabel}</span>
              <span className="text-xs text-slate-400">{c.count}</span>
            </Link>
          ))}
        </div>
      </section>
      <Editorial content={editorialLoc} />
      <CtaAlta titulo={`¿Tienes un negocio en ${loc.cityLabel}?`} sub={`Date de alta gratis y aparece en el directorio de ${loc.cityLabel}.`} />
    </main>
  );
}

function CtaAlta({ titulo, sub }: { titulo: string; sub: string }) {
  return (
    <section className="bg-gradient-to-br from-pink-600 to-fuchsia-600 text-white">
      <div className="max-w-5xl mx-auto px-4 py-12 text-center">
        <h2 className="text-2xl sm:text-3xl font-black">{titulo}</h2>
        <p className="mt-2 text-white/90 max-w-xl mx-auto">{sub}</p>
        <Link href="/registro" className="mt-6 inline-block bg-white text-pink-700 font-bold rounded-full px-6 py-3 hover:bg-pink-50 transition">
          Añadir mi negocio gratis
        </Link>
      </div>
    </section>
  );
}
