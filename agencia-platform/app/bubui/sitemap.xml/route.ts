/**
 * Sitemap dinámico de Bubui para Google y otros buscadores.
 *
 *   GET https://bubui.app/sitemap.xml   (middleware reescribe a /bubui/sitemap.xml)
 *
 * Incluye, con URLs CANÓNICAS y limpias (bubui.app/…, sin prefijo /bubui):
 *   - Informativa, alta y directorio.
 *   - Directorio SEO: /{categoria} y /{categoria}/{localidad}.
 *   - Fichas públicas /n/<slug> de los negocios activos.
 *
 * Cache 1h (revalidate).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { bubuiBaseUrl } from "@/lib/bubui/url";
import { getDirectoryIndex, getAllLocalities, getAllProvinces } from "@/lib/bubui/directory";
import { getRankablePairs } from "@/lib/bubui/rankings";

// Dinámica: se genera en runtime (no en build) para no depender de la BD al
// compilar. El middleware lo sirve en bubui.app/sitemap.xml.
export const dynamic = "force-dynamic";

function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;"
  })[c] as string);
}

export async function GET() {
  const base = bubuiBaseUrl();
  const today = new Date().toISOString().slice(0, 10);

  const [businesses, dir, localities, provinces, rankable] = await Promise.all([
    prisma.bubuiBusiness.findMany({ where: { active: true }, select: { slug: true, updatedAt: true } }),
    getDirectoryIndex(),
    getAllLocalities(),
    getAllProvinces(),
    getRankablePairs()
  ]);

  const urls: { loc: string; lastmod: string; priority: string }[] = [
    { loc: `${base}/`, lastmod: today, priority: "1.0" },
    { loc: `${base}/directorio`, lastmod: today, priority: "0.9" },
    { loc: `${base}/mejores`, lastmod: today, priority: "0.8" },
    { loc: `${base}/registro`, lastmod: today, priority: "0.7" },
    ...dir.categories.map((c) => ({ loc: `${base}/${c.catSlug}`, lastmod: today, priority: "0.7" })),
    ...provinces.map((p) => ({ loc: `${base}/provincia/${p.provSlug}`, lastmod: today, priority: "0.6" })),
    ...localities.map((l) => ({ loc: `${base}/${l.citySlug}`, lastmod: today, priority: "0.7" })),
    ...dir.pairs.map((p) => ({ loc: `${base}/${p.catSlug}/${p.citySlug}`, lastmod: today, priority: "0.8" })),
    ...rankable.map((p) => ({ loc: `${base}/mejores/${p.catSlug}/${p.citySlug}`, lastmod: today, priority: "0.8" })),
    ...businesses.map((b) => ({ loc: `${base}/n/${b.slug}`, lastmod: b.updatedAt.toISOString().slice(0, 10), priority: "0.6" }))
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${esc(u.loc)}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600"
    }
  });
}
