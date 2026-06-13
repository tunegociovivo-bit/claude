/**
 * PATCH /api/bubui/business/[id]/bookings/[bookingId]  { status }
 * El comercio confirma o cancela una cita.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";

export const dynamic = "force-dynamic";

const schema = z.object({ status: z.enum(["pending", "confirmed", "cancelled"]) });

export async function PATCH(req: Request, { params }: { params: { id: string; bookingId: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  const r = await prisma.bubuiBooking.updateMany({
    where: { id: params.bookingId, businessId: params.id },
    data: { status: parsed.data.status }
  });
  if (r.count === 0) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  return NextResponse.json({ ok: true });
}
