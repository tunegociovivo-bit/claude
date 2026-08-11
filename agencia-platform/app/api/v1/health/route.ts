/**
 * GET /api/v1/health
 *
 * Healthcheck simple. Verifica que la BD responde (ping prisma) y
 * que el proceso está vivo. Usado por:
 *   - Watchdog post-deploy del self-heal: si /api/v1/health no
 *     responde 200 tras 5min de un auto-merge, asume que el fix
 *     rompió el deploy y avisa.
 *   - Railway (si configuras healthcheck endpoint en el dashboard).
 *   - Monitoreo externo si lo añades.
 *
 * Sin auth. La respuesta NO incluye info sensible.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Ping BD — query barato que verifica conexión
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      uptime: process.uptime(),
      ts: new Date().toISOString()
    });
  } catch (e: any) {
    // Endpoint público (healthcheck de Railway): no filtramos el detalle del
    // error (podría revelar host/driver de la BD). El detalle va a logs.
    console.error("[health] database_unreachable:", e?.message ?? String(e));
    return NextResponse.json(
      { ok: false, error: "database_unreachable" },
      { status: 503 }
    );
  }
}
