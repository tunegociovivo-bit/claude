import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceId, unauthorized } from "@/lib/auth";
import { deleteAppointmentFromGoogle, syncAppointmentToGoogle } from "@/lib/google-calendar";

const patchSchema = z.object({
  customerName: z.string().min(1).optional(),
  datetime: z.string().optional(),
  durationMin: z.number().int().positive().optional(),
  status: z.enum(["confirmada", "pendiente", "cancelada"]).optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let workspaceId: string;
  try {
    workspaceId = await requireWorkspaceId();
  } catch {
    return unauthorized();
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const data: any = {};
  if (d.customerName) data.customerName = d.customerName;
  if (d.datetime) {
    const dt = new Date(d.datetime);
    if (isNaN(dt.getTime())) {
      return NextResponse.json({ error: "Fecha no válida" }, { status: 400 });
    }
    data.startsAt = dt;
  }
  if (d.durationMin) data.durationMin = d.durationMin;
  if (d.status) data.status = d.status;
  if (d.notes !== undefined) data.notes = d.notes;

  const result = await prisma.appointment.updateMany({
    where: { id: params.id, workspaceId },
    data,
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }
  await syncAppointmentToGoogle(workspaceId, params.id).catch((error) =>
    console.error("[google-calendar] actualización:", error)
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  let workspaceId: string;
  try {
    workspaceId = await requireWorkspaceId();
  } catch {
    return unauthorized();
  }
  const appointment = await prisma.appointment.findFirst({
    where: { id: params.id, workspaceId }, select: { googleEventId: true },
  });
  const result = await prisma.appointment.deleteMany({
    where: { id: params.id, workspaceId },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }
  if (appointment?.googleEventId) {
    await deleteAppointmentFromGoogle(workspaceId, appointment.googleEventId).catch((error) =>
      console.error("[google-calendar] eliminación:", error)
    );
  }
  return NextResponse.json({ ok: true });
}
