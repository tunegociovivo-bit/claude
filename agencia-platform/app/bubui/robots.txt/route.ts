/**
 * robots.txt para la sección Bubui.
 *   GET /bubui/robots.txt
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
Allow: /bubui
Allow: /bubui/n/
Allow: /bubui/registro
Disallow: /bubui/admin
Disallow: /bubui/app
Disallow: /bubui/negocio
Disallow: /bubui/scan/
Disallow: /api/

Sitemap: ${origin}/bubui/sitemap.xml
`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
