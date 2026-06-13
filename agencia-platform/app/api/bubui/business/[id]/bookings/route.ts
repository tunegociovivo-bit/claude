/**
 * GET /api/bubui/business/[id]/bookings → citas del comercio (auth negocio).
 *   ?scope=upcoming (def) | all
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const scope = new URL(req.url).searchParams.get("scope") ?? "upcoming";
  const where: any = { businessId: params.id };
  if (scope === "upcoming") where.startsAt = { gte: new Date(Date.now() - 3 * 3600_000) };
  const items = await prisma.bubuiBooking.findMany({
    where,
    orderBy: { startsAt: "asc" },
    take: 200,
    include: { service: { select: { name: true, durationMin: true } } }
  });
  return NextResponse.json({ ok: true, items });
}
