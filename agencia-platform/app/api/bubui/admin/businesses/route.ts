/**
 * GET   /api/bubui/admin/businesses  → lista de comercios.
 * PATCH /api/bubui/admin/businesses  → { id, featured?, active? } actualiza flags.
 * (cabecera x-admin-token)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { adminTokenOk } from "@/lib/bubui/admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const businesses = await prisma.bubuiBusiness.findMany({
    orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      category: true,
      brandColor: true,
      latitude: true,
      longitude: true,
      address: true,
      city: true,
      ownerName: true,
      ownerEmail: true,
      ownerPhone: true,
      plan: true,
      active: true,
      featured: true,
      slug: true,
      createdAt: true,
      posterDeliveryRequestedAt: true,
      posterDeliveryAddress: true,
      posterDeliveryPhone: true,
      posterDeliveryNote: true,
      posterDeliveredAt: true,
      _count: { select: { offers: true, purchases: true } }
    }
  });
  return NextResponse.json({ count: businesses.length, businesses });
}

const patchSchema = z.object({
  id: z.string().min(1),
  featured: z.boolean().optional(),
  active: z.boolean().optional(),
  // Marca el cartel como entregado (o reabre la entrega con false).
  posterDelivered: z.boolean().optional()
});

export async function PATCH(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  }
  const { id, posterDelivered, featured, active } = parsed.data;
  const updated = await prisma.bubuiBusiness.update({
    where: { id },
    data: {
      ...(featured !== undefined ? { featured } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(posterDelivered !== undefined ? { posterDeliveredAt: posterDelivered ? new Date() : null } : {})
    },
    select: { id: true, featured: true, active: true, posterDeliveredAt: true }
  });
  return NextResponse.json(updated);
}
