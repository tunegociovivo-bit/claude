/**
 * Sitemap dinámico de Bipi para Google y otros buscadores.
 *
 *   GET /bipi/sitemap.xml
 *
 * Incluye:
 *   - Landing /bipi
 *   - Páginas públicas /bipi/n/<slug> de todos los negocios activos.
 *
 * Cache 1h (revalidate).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const revalidate = 3600;

function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;"
  })[c] as string);
}

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const businesses = await prisma.bubuiBusiness.findMany({
    where: { active: true },
    select: { slug: true, updatedAt: true }
  });

  const urls = [
    {
      loc: `${origin}/bipi`,
      lastmod: new Date().toISOString().slice(0, 10),
      priority: "1.0"
    },
    {
      loc: `${origin}/bipi/registro`,
      lastmod: new Date().toISOString().slice(0, 10),
      priority: "0.7"
    },
    ...businesses.map((b) => ({
      loc: `${origin}/bipi/n/${b.slug}`,
      lastmod: b.updatedAt.toISOString().slice(0, 10),
      priority: "0.8"
    }))
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
