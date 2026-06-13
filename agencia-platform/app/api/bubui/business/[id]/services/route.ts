/**
 * GET  /api/bubui/business/[id]/services  → servicios (con auth: todos; público
 *       sin auth: solo activos, para el formulario de cita).
 * POST /api/bubui/business/[id]/services  → crea un servicio (auth negocio).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(1).max(120),
  durationMin: z.number().int().min(5).max(480).optional(),
  priceEur: z.number().min(0).max(100000).optional().nullable(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional()
});

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const isOwner = await businessTokenAllows(req.headers.get("authorization"), params.id);
  const items = await prisma.bubuiService.findMany({
    where: { businessId: params.id, ...(isOwner ? {} : { active: true }) },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
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
  const item = await prisma.bubuiService.create({
    data: {
      businessId: params.id,
      name: d.name,
      durationMin: d.durationMin ?? 30,
      priceEur: d.priceEur ?? null,
      active: d.active ?? true,
      sortOrder: d.sortOrder ?? 0
    }
  });
  return NextResponse.json({ ok: true, item }, { status: 201 });
}
