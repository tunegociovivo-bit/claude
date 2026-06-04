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
  return NextResponse.json({ count: customers.length, customers });
}
