/**
 * Middleware: redirige a /login si el usuario no tiene sesión.
 * Excluye:
 *   - /login y /api/auth/* (NextAuth)
 *   - /r/* y /v/* (widgets públicos embebibles)
 *   - /api/v1/workspace/public, /api/v1/reviews/generate, /api/v1/voice/* (endpoints públicos)
 *   - /api/v1/leads/webhook/* (webhook con token propio)
 *   - /api/v1/internal/* (cron protegido por bearer)
 *   - /_next, /favicon, /sw.js, /icon* (assets)
 *
 * NOTA: este middleware usa la cookie de NextAuth para detectar sesión
 * sin tener que tocar la BD. La validación real sigue siendo en cada
 * endpoint API vía withApi/authenticate.
 */

import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth",
  "/r/",
  "/v/",
  "/p/",
  "/api/v1/workspace/public",
  "/api/v1/reviews/generate",
  "/api/v1/voice/transcribe",
  "/api/v1/voice/draft",
  "/api/v1/leads/webhook/",
  "/api/v1/internal/",
  "/api/public/"
];

function isPublic(pathname: string): boolean {
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/apple-touch-icon") ||
    pathname === "/sw.js" ||
    pathname === "/manifest.json" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/robots.txt"
  ) {
    return true;
  }
  return PUBLIC_PATHS.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

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

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Aplica a todas las rutas excepto las que ya excluimos en isPublic().
     * El matcher de Next.js sólo soporta excluir asset paths comunes; el
     * resto se filtra dentro del propio middleware.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon-|sw.js|manifest.json|robots.txt).*)"
  ]
};
