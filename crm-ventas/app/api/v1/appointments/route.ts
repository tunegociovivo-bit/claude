import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceId, unauthorized } from "@/lib/auth";
import { bookAppointment } from "@/lib/appointments";

const createSchema = z.object({
  customerName: z.string().min(1),
  customerPhone: z.string().optional(),
  datetime: z.string(), // ISO
  durationMin: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

export async function GET(req: NextRequest) {
  let workspaceId: string;
  try {
    workspaceId = await requireWorkspaceId();
  } catch {
    return unauthorized();
  }
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const where: any = { workspaceId };
  if (from || to) {
    where.startsAt = {};
    if (from) where.startsAt.gte = new Date(from);
    if (to) where.startsAt.lt = new Date(to);
  }
  const appointments = await prisma.appointment.findMany({
    where,
    orderBy: { startsAt: "asc" },
    take: 1000,
  });
  return NextResponse.json({ appointments });
}

export async function POST(req: NextRequest) {
  let workspaceId: string;
  try {
    workspaceId = await requireWorkspaceId();
  } catch {
    return unauthorized();
  }
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const result = await bookAppointment({
    workspaceId,
    customerName: d.customerName,
    customerPhone: d.customerPhone,
    datetimeISO: d.datetime,
    durationMin: d.durationMin,
    notes: d.notes,
    source: "manual",
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, conflicts: result.conflicts }, { status: 409 });
  }
  const appointment = await prisma.appointment.findUnique({
    where: { id: result.appointmentId },
  });
  return NextResponse.json({ appointment }, { status: 201 });
}
