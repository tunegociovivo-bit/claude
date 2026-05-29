/**
 * GET /api/bubui/admin/businesses  (cabecera x-admin-token)
 * Lista de comercios registrados en Bubui.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { adminTokenOk } from "@/lib/bubui/admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!adminTokenOk(req)) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const businesses = await prisma.bubuiBusiness.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      category: true,
      brandColor: true,
      lat: true,
      lng: true,
      address: true,
      phone: true,
      whatsapp: true,
      active: true,
      slug: true,
      createdAt: true,
      _count: { select: { offers: true, scans: true } }
    }
  });
  return NextResponse.json({ count: businesses.length, businesses });
}
