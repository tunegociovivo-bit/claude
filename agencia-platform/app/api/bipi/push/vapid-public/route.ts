/**
 * GET /api/bipi/push/vapid-public
 *
 * Devuelve la VAPID public key necesaria para que el navegador del
 * cliente se suscriba a notificaciones push. Si Bipi push no está
 * configurado, devuelve { enabled: false } — la PWA debe ocultar la
 * UI de notificaciones.
 */

import { NextResponse } from "next/server";
import { isBipiPushEnabled, getBipiVapidPublicKey } from "@/lib/bipi/push";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isBipiPushEnabled()) {
    return NextResponse.json({ enabled: false, key: null });
  }
  return NextResponse.json({ enabled: true, key: getBipiVapidPublicKey() });
}
