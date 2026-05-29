/**
 * Slot patrocinado (hero del feed del cliente durante 24h).
 *
 * POST /api/bubui/business/[id]/sponsored  { title, body }
 *   → Crea un slot que arranca ya y dura 24h. Limitado por cuota mensual
 *     (Pro: 1/mes, Premium: 4/mes). Gated por plan != "free".
 *
 * GET  /api/bubui/business/[id]/sponsored
 *   → Devuelve estado: cuota usada/disponible, slot activo si lo hay, y el
 *     histórico reciente del negocio.
 *
 * Auth: Bearer del negocio.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { isPaidPlan, sponsoredQuotaForPlan } from "@/lib/bubui/plan";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  title: z.string().trim().min(3).max(60),
  body: z.string().trim().min(5).max(180)
});

function startOfMonth(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!businessTokenAllows(req.headers.get("authorization"), params.id)) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const business = await prisma.bubuiBusiness.findUnique({
    where: { id: params.id },
    select: { plan: true }
  });
  if (!business) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });

  const now = new Date();
  const monthStart = startOfMonth();
  const [usedThisMonth, active, recent] = await Promise.all([
    prisma.bubuiSponsoredSlot.count({
      where: { businessId: params.id, createdAt: { gte: monthStart } }
    }),
    prisma.bubuiSponsoredSlot.findFirst({
      where: { businessId: params.id, startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: { startsAt: "desc" }
    }),
    prisma.bubuiSponsoredSlot.findMany({
      where: { businessId: params.id },
      orderBy: { createdAt: "desc" },
      take: 5
    })
  ]);
  const quota = sponsoredQuotaForPlan(business.plan);
  return NextResponse.json({
    plan: business.plan,
    quota,
    usedThisMonth,
    remaining: Math.max(0, quota - usedThisMonth),
    active,
    recent
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!businessTokenAllows(req.headers.get("authorization"), params.id)) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation", message: parsed.error.issues[0]?.message ?? "Datos no válidos" } },
      { status: 400 }
    );
  }
  const business = await prisma.bubuiBusiness.findUnique({
    where: { id: params.id },
    select: { plan: true, city: true }
  });
  if (!business) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  if (!isPaidPlan(business.plan)) {
    return NextResponse.json(
      { error: { code: "plan_required", message: "Promocionarse en el feed requiere plan Pro o Premium." } },
      { status: 402 }
    );
  }

  // Cuota mensual.
  const monthStart = startOfMonth();
  const quota = sponsoredQuotaForPlan(business.plan);
  const used = await prisma.bubuiSponsoredSlot.count({
    where: { businessId: params.id, createdAt: { gte: monthStart } }
  });
  if (used >= quota) {
    return NextResponse.json(
      { error: { code: "quota_exceeded", message: `Has usado tus ${quota} slots de este mes.` } },
      { status: 409 }
    );
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const slot = await prisma.bubuiSponsoredSlot.create({
    data: {
      businessId: params.id,
      title: parsed.data.title,
      body: parsed.data.body,
      city: business.city,
      startsAt: now,
      endsAt
    }
  });
  return NextResponse.json({ ok: true, slot, remaining: quota - used - 1 });
}
