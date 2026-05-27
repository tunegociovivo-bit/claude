/**
 * robots.txt para la sección Bipi.
 *   GET /bipi/robots.txt
 *
 * Permite a Google indexar las páginas públicas y le señala el sitemap.
 * Bloquea las rutas internas (admin, app, negocio, scan) que no aportan
 * SEO y podrían filtrar metadata.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const body = `User-agent: *
Allow: /bipi
Allow: /bipi/n/
Allow: /bipi/registro
Disallow: /bipi/admin
Disallow: /bipi/app
Disallow: /bipi/negocio
Disallow: /bipi/scan/
Disallow: /api/

Sitemap: ${origin}/bipi/sitemap.xml
`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
