/**
 * Middleware: redirige a /login si el usuario no tiene sesión.
 * Excluye:
 *   - /login y /api/auth/* (NextAuth)
 *   - /r/* y /v/* (widgets públicos embebibles)
 *   - /api/v1/workspace/public, /api/v1/reviews/generate, /api/v1/voice/* (endpoints públicos)
 *   - /api/v1/leads/webhook/* (webhook con token propio)
 *   - /api/v1/internal/* (cron protegido por bearer)
 *   - /_next, /favicon, /sw.js, /icon* (assets)
 *   - Todo el dominio bubui.app (producto público con su propia auth)
 *
 * NOTA: este middleware usa la cookie de NextAuth para detectar sesión
 * sin tener que tocar la BD. La validación real sigue siendo en cada
 * endpoint API vía withApi/authenticate.
 */

import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const BUBUI_HOSTS = new Set(["bubui.app", "www.bubui.app"]);

const PUBLIC_PATHS = [
  "/login",
  "/api/auth",
  // iOS Universal Links + Android App Links: deben servirse públicos y sin
  // redirecciones para que el SO los valide.
  "/.well-known/",
  "/r/",
  "/v/",
  "/p/",
  "/api/v1/workspace/public",
  "/api/v1/reviews/generate",
  "/api/v1/voice/transcribe",
  "/api/v1/voice/draft",
  "/api/v1/leads/webhook/",
  "/api/webhooks/",
  "/api/v1/gmb/reviews/webhook",
  "/api/v1/gmb/widget/",
  "/api/v1/gmb/buscador/run-scheduled",
  "/api/v1/gmb/reports/monthly-cron",
  "/api/v1/voice/webhook",
  "/gmb-widget/",
  "/api/v1/internal/",
  "/api/public/",
  // Bubui es un producto público (cliente final + alta de negocios). Sus
  // páginas y endpoints no usan NextAuth: los del negocio validan su
  // propio token dentro del endpoint; los del cliente son públicos.
  "/bubui/",
  "/api/bubui/",
  // Compatibilidad temporal: rutas antiguas /bipi/* (QR impresos y app
  // instalada antes del rebrand). Se reescriben a /bubui/* en next.config.
  "/bipi/",
  "/api/bipi/"
];

function isPublic(pathname: string): boolean {
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/apple-touch-icon") ||
    pathname === "/sw.js" ||
    pathname === "/bubui-sw.js" ||
    pathname === "/manifest.json" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/robots.txt"
  ) {
    return true;
  }
  return PUBLIC_PATHS.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));
}

/** Rutas de bubui.app que NO deben indexarse: el producto privado (panel,
 *  app de cliente, admin, scan/referral) y los accesos a la ruta interna
 *  /bubui/* (no canónica). El resto (informativa, /registro, /n/, directorio)
 *  sí se indexa. */
function bubuiNoindex(pathname: string): boolean {
  const priv = ["/usuarios", "/negocios", "/negocio", "/app", "/admin", "/scan", "/r/", "/demo", "/bubui"];
  return priv.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const host = req.headers.get("host") ?? "";

  // ── Dominio bubui.app ────────────────────────────────────────────────────
  // Todo el dominio es público (el producto tiene su propia auth).
  // Reescribimos las rutas al subárbol /bubui/* para que Next.js sirva
  // el contenido correcto sin redirect visible en la barra del navegador.
  if (BUBUI_HOSTS.has(host)) {
    // robots.txt y sitemap.xml: servimos los de Bubui (no el robots global del
    // hub, que es Disallow: /). Así Google puede rastrear bubui.app.
    if (pathname === "/robots.txt" || pathname === "/sitemap.xml") {
      const u = req.nextUrl.clone();
      u.pathname = pathname === "/robots.txt" ? "/bubui/robots.txt" : "/bubui/sitemap.xml";
      return NextResponse.rewrite(u);
    }
    // Assets de Next.js, service worker y manifest: sin reescritura.
    if (
      pathname.startsWith("/_next") ||
      pathname.startsWith("/api/") ||
      pathname.startsWith("/.well-known") ||
      pathname === "/bubui-sw.js" ||
      pathname === "/manifest.webmanifest"
    ) {
      return NextResponse.next();
    }
    // Alias "bonitos" del dominio público bubui.app:
    //   /negocios(/…) → panel del comercio (/bubui/negocio)
    //   /usuarios(/…) → app de clientes (/bubui/app)
    //   /registro, /privacidad, /soporte, /n/…, /r/… → /bubui/<path>
    //   /directorio, /{categoria}, /{categoria}/{localidad} → directorio SEO
    //   /            → /bubui (informativa)
    // Las rutas antiguas /negocio y /app siguen sirviendo vía el prefijo
    // genérico (compatibilidad con QR/enlaces ya repartidos).
    const url = req.nextUrl.clone();
    if (pathname.startsWith("/bubui")) {
      // Acceso directo a la ruta interna (no canónica): se sirve sin reescritura.
      url.pathname = pathname;
    } else if (pathname === "/negocios" || pathname.startsWith("/negocios/")) {
      url.pathname = "/bubui/negocio" + pathname.slice("/negocios".length);
    } else if (pathname === "/usuarios" || pathname.startsWith("/usuarios/")) {
      url.pathname = "/bubui/app" + pathname.slice("/usuarios".length);
    } else {
      url.pathname = pathname === "/" ? "/bubui" : "/bubui" + pathname;
    }
    const res = pathname.startsWith("/bubui") ? NextResponse.next() : NextResponse.rewrite(url);
    // Indexación: público de bubui.app SÍ; páginas privadas del producto NO.
    res.headers.set("X-Robots-Tag", bubuiNoindex(pathname) ? "noindex, nofollow" : "index, follow");
    return res;
  }
  // ────────────────────────────────────────────────────────────────────────

  if (isPublic(pathname)) return NextResponse.next();

  // Endpoints API que aceptan Bearer (API keys) → dejamos pasar, withApi
  // se encarga de validar.
  const auth = req.headers.get("authorization");
  if (pathname.startsWith("/api/") && auth?.toLowerCase().startsWith("bearer ")) {
    return NextResponse.next();
  }

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET
  });

  if (!token) {
    // En APIs devolvemos 401 JSON, no redirect
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: { code: "unauthenticated", message: "Inicia sesión" } },
        { status: 401 }
      );
    }
    // Páginas → redirect a /login con callbackUrl
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?callbackUrl=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  // Exponemos la ruta como header de la request para que los Server
  // Components (p. ej. app/admin/layout.tsx) puedan saber qué página se está
  // sirviendo y aplicar autorización por ruta. Next.js no da el pathname a los
  // layouts de otra forma.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    /*
     * Aplica a todas las rutas excepto las que ya excluimos en isPublic().
     * El matcher de Next.js sólo soporta excluir asset paths comunes; el
     * resto se filtra dentro del propio middleware.
     *
     * OJO: robots.txt NO se excluye aquí a propósito. En bubui.app el
     * middleware debe interceptarlo para servir el robots de Bubui (Allow +
     * sitemap) en lugar del robots global del hub (Disallow: /). En el hub,
     * isPublic() lo deja pasar igual. (sitemap.xml tampoco se excluye, por eso
     * ya funcionaba.)
     */
    "/((?!_next/static|_next/image|favicon.ico|icon-|sw.js|manifest.json).*)"
  ]
};
