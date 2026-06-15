/**
 * PATCH  /api/bubui/business/[id]/services/[serviceId] → edita un servicio.
 * DELETE /api/bubui/business/[id]/services/[serviceId] → lo borra.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(1).max(120).optional(),
  durationMin: z.number().int().min(5).max(480).optional(),
  unit: z.string().trim().max(40).nullable().optional(),
  priceEur: z.number().min(0).max(100000).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional()
});

export async function PATCH(req: Request, { params }: { params: { id: string; serviceId: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  const data = { ...parsed.data };
  if (data.unit === "") data.unit = null;
  const r = await prisma.bubuiService.updateMany({ where: { id: params.serviceId, businessId: params.id }, data });
  if (r.count === 0) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string; serviceId: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const r = await prisma.bubuiService.deleteMany({ where: { id: params.serviceId, businessId: params.id } });
  if (r.count === 0) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  return NextResponse.json({ ok: true });
}
