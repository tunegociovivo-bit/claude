/**
 * robots.txt de Bubui (servido en bubui.app/robots.txt vía middleware).
 *
 * Permite indexar las páginas públicas (informativa, alta, directorio SEO,
 * fichas) y bloquea el producto privado (panel, app de cliente, admin, scan).
 * Usa rutas LIMPIAS (las canónicas de bubui.app, sin prefijo /bubui).
 */

import { NextResponse } from "next/server";
import { bubuiBaseUrl } from "@/lib/bubui/url";

export const dynamic = "force-dynamic";

export async function GET() {
  const base = bubuiBaseUrl();
  const body = `User-agent: *
Allow: /
Disallow: /usuarios
Disallow: /negocios
Disallow: /negocio
Disallow: /app
Disallow: /admin
Disallow: /scan/
Disallow: /r/
Disallow: /demo/
Disallow: /bubui/
Disallow: /api/

Sitemap: ${base}/sitemap.xml
`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
