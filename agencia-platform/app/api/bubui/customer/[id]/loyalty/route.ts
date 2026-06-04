/**
 * GET /api/bubui/customer/[id]/loyalty
 *
 * Lista las tarjetas de fidelidad activas del cliente: para cada negocio
 * donde ha comprado y que tiene la fidelidad activada, devuelve el
 * progreso del ciclo actual y el total de recompensas ya conseguidas.
 */

import { NextResponse } from "next/server";
import { listLoyaltyCards } from "@/lib/bubui/loyalty";
import { customerAuthOk } from "@/lib/bubui/customer-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await customerAuthOk(req, params.id))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }
  const items = await listLoyaltyCards(params.id);
  return NextResponse.json({ items, count: items.length });
}
