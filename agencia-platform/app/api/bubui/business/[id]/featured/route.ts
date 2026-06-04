/**
 * POST /api/bubui/business/[id]/featured  { featured: boolean }
 *
 * Activa/desactiva el pin destacado del negocio en el mapa y en Descubre.
 * Gated: plan != "free". Devuelve el nuevo estado.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { isPaidPlan } from "@/lib/bubui/plan";

export const dynamic = "force-dynamic";

const schema = z.object({ featured: z.boolean() });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: "Falta featured" } }, { status: 400 });
  }
  const business = await prisma.bubuiBusiness.findUnique({
    where: { id: params.id },
    select: { plan: true }
  });
  if (!business) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  if (parsed.data.featured && !isPaidPlan(business.plan)) {
    return NextResponse.json(
      { error: { code: "plan_required", message: "Destacarse requiere plan Pro o Premium." } },
      { status: 402 }
    );
  }
  const updated = await prisma.bubuiBusiness.update({
    where: { id: params.id },
    data: { featured: parsed.data.featured },
    select: { id: true, featured: true }
  });
  return NextResponse.json({ ok: true, featured: updated.featured });
}
