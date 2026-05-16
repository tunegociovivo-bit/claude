/**
 * GET /api/cron/calendar-sync
 *
 * Sincronización pull de Google Calendar para cada conexión activa.
 * Programado cada 5-15 min vía GitHub Actions. Incremental usando el
 * syncToken que Google nos devuelve tras cada listado.
 *
 * Seguridad: Authorization Bearer CRON_SECRET o ?secret=...
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { pullForConnection } from "@/lib/integrations/google-calendar/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === secret) return true;
  return false;
}

export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connections = await prisma.googleCalendarConnection.findMany({
    where: { pullEnabled: true }
  });

  const results: Array<{ id: string; ok: boolean; created?: number; updated?: number; deleted?: number; error?: string }> = [];
  for (const conn of connections) {
    try {
      const r = await pullForConnection(conn);
      results.push({ id: conn.id, ok: true, ...r });
    } catch (e: any) {
      results.push({ id: conn.id, ok: false, error: String(e?.message ?? e).slice(0, 200) });
    }
  }

  return NextResponse.json({ ok: true, connections: results.length, results });
}
