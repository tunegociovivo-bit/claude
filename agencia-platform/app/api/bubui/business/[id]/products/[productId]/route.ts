/**
 * PATCH  /api/bubui/business/[id]/products/[productId] → edita un producto.
 * DELETE /api/bubui/business/[id]/products/[productId] → lo borra.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  priceEur: z.number().min(0).max(100000).nullable().optional(),
  imageUrl: z.string().url().max(2000).nullable().optional(),
  stock: z.number().int().min(0).max(1000000).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional()
});

export async function PATCH(req: Request, { params }: { params: { id: string; productId: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  const r = await prisma.bubuiProduct.updateMany({
    where: { id: params.productId, businessId: params.id },
    data: parsed.data
  });
  if (r.count === 0) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string; productId: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const r = await prisma.bubuiProduct.deleteMany({ where: { id: params.productId, businessId: params.id } });
  if (r.count === 0) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  return NextResponse.json({ ok: true });
}
