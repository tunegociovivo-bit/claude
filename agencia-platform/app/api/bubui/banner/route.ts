/**
 * GET /api/bubui/banner  (público)
 * Banner del Home que consume la app móvil.
 *
 * Prioridad:
 *   1. Banner manual del admin si está activo (override total).
 *   2. Campaña de banner ganada por un negocio (referidos B2B), servida por
 *      turnos desde la cola, si tiene imagen.
 *   3. { active:false } → la app usa su banner por defecto.
 */

import { NextResponse } from "next/server";
import { getHomeBanner } from "@/lib/bubui/banner";
import { tickBannerQueue } from "@/lib/bubui/business-referral";

export const dynamic = "force-dynamic";

export async function GET() {
  const manual = await getHomeBanner();
  if (manual.active && manual.imageUrl) {
    return NextResponse.json(manual);
  }
  // Sin banner manual: avanza la cola de campañas y muestra la activa.
  try {
    const campaign = await tickBannerQueue();
    if (campaign?.imageUrl) {
      return NextResponse.json({ imageUrl: campaign.imageUrl, link: campaign.link ?? "", active: true });
    }
  } catch {}
  return NextResponse.json({ imageUrl: "", link: "", active: false });
}
