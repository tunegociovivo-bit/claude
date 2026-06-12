/**
 * GET /api/cron/calendar-watch-renew
 *
 * Renueva los watch channels de Google Calendar que expiren en
 * menos de 48h. Google obliga a renovar cada 30 días máximo; si
 * dejamos caducar uno, los push notifications dejan de llegar.
 *
 * Seguridad: Bearer CRON_SECRET o ?secret=
 */

import { NextResponse } from "next/server";
import { renewExpiringWatches } from "@/lib/integrations/google-calendar/watch";
import { cronAuthOk } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function authorize(req: Request): Promise<boolean> {
  return cronAuthOk(req);
}

export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await renewExpiringWatches();
  return NextResponse.json({ ok: true, ...result });
}
