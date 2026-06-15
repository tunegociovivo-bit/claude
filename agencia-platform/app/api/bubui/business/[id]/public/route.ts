/**
 * GET /api/bubui/business/[id]/public
 *
 * Información pública mínima de un negocio (sin auth), para que la app sepa,
 * tras escanear el QR, si debe exigir la foto del ticket (anti-fraude).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const b = await prisma.bubuiBusiness.findUnique({
    where: { id: params.id },
    select: {
      id: true, name: true, slug: true, category: true, active: true, requireTicket: true,
      businessType: true, mesaEnabled: true
    }
  });
  if (!b || !b.active) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }
  return NextResponse.json({
    id: b.id,
    name: b.name,
    slug: b.slug,
    category: b.category,
    requireTicket: b.requireTicket,
    businessType: b.businessType,
    // La app ofrece la Mesa Colectiva tras escanear el QR del local si está activa.
    mesaEnabled: !!b.mesaEnabled
  });
}
