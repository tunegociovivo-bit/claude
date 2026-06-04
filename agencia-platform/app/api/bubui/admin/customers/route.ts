/**
 * GET /api/bubui/admin/customers  (cabecera x-admin-token)
 * Lista de usuarios registrados en Bubui con sus datos y última ubicación.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { adminTokenOk } from "@/lib/bubui/admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const customers = await prisma.bubuiCustomer.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      birthDate: true,
      gender: true,
      postalCode: true,
      lastLat: true,
      lastLng: true,
      lastLocationAt: true,
      appVersion: true,
      appBuild: true,
      appPlatform: true,
      lastSeenAt: true,
      totalSaved: true,
      totalPurchases: true,
      ambassadorLevel: true,
      createdAt: true,
      _count: { select: { purchases: true } }
    }
  });

  // Gustos = categorías de los negocios donde el cliente tiene compras
  // confirmadas. Sirve para segmentar los envíos push por intereses.
  const purchases = await prisma.bubuiPurchase.findMany({
    where: { status: "confirmed" },
    select: { customerId: true, business: { select: { category: true } } }
  });
  const catMap = new Map<string, Set<string>>();
  for (const p of purchases) {
    const cat = p.business?.category;
    if (!cat) continue;
    let set = catMap.get(p.customerId);
    if (!set) catMap.set(p.customerId, (set = new Set()));
    set.add(cat);
  }
  const withCats = customers.map((c) => ({ ...c, categories: Array.from(catMap.get(c.id) ?? []) }));

  return NextResponse.json({ count: withCats.length, customers: withCats });
}
