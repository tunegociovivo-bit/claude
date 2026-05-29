/**
 * GET /api/bubui/stats
 * Conteo público para la app (p. ej. decidir si mostrar pestañas que
 * requieren un mínimo de comercios).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const businesses = await prisma.bubuiBusiness.count({ where: { active: true } });
  return NextResponse.json({ businesses });
}
