/**
 * Universal Links de iOS. iOS descarga este archivo del dominio para saber
 * qué app puede abrir qué rutas. Se activa cuando configures:
 *   APPLE_APP_ID = "<TEAM_ID>.com.negociovivo.bubui"  (ej: ABCDE12345.com.negociovivo.bubui)
 * Hasta entonces devuelve 404 (no rompe nada; el puente cae al flujo web).
 *
 * Debe servirse como application/json, sin redirección y sin auth (ver
 * middleware: /.well-known/ es público).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const appID = process.env.APPLE_APP_ID;
  if (!appID) {
    return new NextResponse("Not configured", { status: 404 });
  }
  const body = {
    applinks: {
      apps: [],
      details: [
        {
          appID,
          // Solo las URLs de escaneo abren la app; el resto sigue en web.
          paths: ["/bubui/scan/*", "/bipi/scan/*"]
        }
      ]
    }
  };
  return new NextResponse(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
