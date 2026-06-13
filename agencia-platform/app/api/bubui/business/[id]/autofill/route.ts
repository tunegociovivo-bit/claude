/**
 * POST /api/bubui/business/[id]/autofill
 *
 * La IA + datos reales (Google Places + web del negocio) proponen un BORRADOR
 * de redes y reseñas (Instagram/Facebook/TikTok/Trustpilot/Google). NO guarda
 * nada: el dueño lo verifica y guarda con el PATCH de perfil.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { autofillBusinessProfile } from "@/lib/bubui/autofill";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const b = await prisma.bubuiBusiness.findUnique({
    where: { id: params.id },
    select: { name: true, city: true, category: true, address: true }
  });
  if (!b) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });

  // BubuiBusiness no guarda web; Google Places la descubre y de ahí scrapeamos.
  const draft = await autofillBusinessProfile({
    name: b.name,
    city: b.city,
    category: b.category,
    address: b.address
  });
  return NextResponse.json({ ok: true, draft });
}
