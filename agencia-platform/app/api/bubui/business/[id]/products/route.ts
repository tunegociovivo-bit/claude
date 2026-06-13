/**
 * GET  /api/bubui/business/[id]/products  → lista del catálogo (comercio).
 * POST /api/bubui/business/[id]/products  → crea un producto.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional().nullable(),
  priceEur: z.number().min(0).max(100000).optional().nullable(),
  imageUrl: z.string().url().max(2000).optional().nullable(),
  stock: z.number().int().min(0).max(1000000).optional().nullable(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional()
});

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const items = await prisma.bubuiProduct.findMany({
    where: { businessId: params.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }]
  });
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  const d = parsed.data;
  const item = await prisma.bubuiProduct.create({
    data: {
      businessId: params.id,
      name: d.name,
      description: d.description ?? null,
      priceEur: d.priceEur ?? null,
      imageUrl: d.imageUrl ?? null,
      stock: d.stock ?? null,
      active: d.active ?? true,
      sortOrder: d.sortOrder ?? 0
    }
  });
  return NextResponse.json({ ok: true, item }, { status: 201 });
}
