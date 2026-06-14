/**
 * GET /api/bubui/customer/[id]/plus-gifts
 *
 * Regalos exclusivos para el usuario. Solo se devuelven si tiene Bubui Plus
 * activo; en caso contrario { plusActive:false, gifts:[] } para que la app
 * muestre el candado / propuesta de suscripción.
 *
 * Auth: Bearer <customerId>:<token>.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { customerAuthOk } from "@/lib/bubui/customer-auth";
import { isPlusActive } from "@/lib/bubui/plus";
import { getActivePlusGifts } from "@/lib/bubui/plus-gifts";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const customerId = params.id;
  if (!(await customerAuthOk(req, customerId))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }
  const c = await prisma.bubuiCustomer.findUnique({
    where: { id: customerId },
    select: { plan: true, planExpiresAt: true }
  });
  if (!c) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  if (!isPlusActive(c)) {
    return NextResponse.json({ plusActive: false, gifts: [] });
  }
  return NextResponse.json({ plusActive: true, gifts: await getActivePlusGifts() });
}
