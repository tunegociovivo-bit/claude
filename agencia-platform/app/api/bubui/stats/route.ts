/**
 * GET /api/bubui/stats
 * Conteo público + visibilidad de secciones gated (Descubre/Mapa) ya resuelta
 * (umbral de comercios o override del admin). La app usa los flags directamente.
 */

import { NextResponse } from "next/server";
import { getSectionVisibility } from "@/lib/bubui/sections";

export const dynamic = "force-dynamic";

export async function GET() {
  const { businesses, discover, mapa } = await getSectionVisibility();
  // `businesses` se mantiene por compatibilidad con versiones antiguas de la
  // app; las nuevas usan los flags `discover` y `mapa` directamente.
  return NextResponse.json({ businesses, sections: { discover, mapa } });
}
