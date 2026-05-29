/**
 * GET /api/bubui/banner  (público)
 * Banner del Home que consume la app móvil. Si no hay banner activo,
 * devuelve { active:false } y la app usa su banner por defecto.
 */

import { NextResponse } from "next/server";
import { getHomeBanner } from "@/lib/bubui/banner";

export const dynamic = "force-dynamic";

export async function GET() {
  const b = await getHomeBanner();
  return NextResponse.json(b);
}
