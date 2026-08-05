import { prisma } from "@/lib/prisma";
import { findOrCreateContactByPhone, moveContactToStage } from "@/lib/contacts";
import { getWorkspaceSettings } from "@/lib/settings";

export type BookingResult =
  | { ok: true; appointmentId: string; startsAt: string }
  | { ok: false; error: string; conflicts?: { startsAt: string; durationMin: number }[] };

// Citas existentes que solapan el intervalo pedido.
export async function findConflicts(
  workspaceId: string,
  startsAt: Date,
  durationMin: number
) {
  const end = new Date(startsAt.getTime() + durationMin * 60_000);
  const dayStart = new Date(startsAt.getTime() - 24 * 3600_000);
  const candidates = await prisma.appointment.findMany({
    where: {
      workspaceId,
      status: { not: "cancelada" },
      startsAt: { gte: dayStart, lt: end },
    },
    orderBy: { startsAt: "asc" },
    take: 50,
  });
  return candidates.filter((a) => {
    const aEnd = new Date(a.startsAt.getTime() + a.durationMin * 60_000);
    return a.startsAt < end && aEnd > startsAt;
  });
}

// Citas de un día (para que SONIA sepa qué huecos están ocupados).
export async function appointmentsOfDay(workspaceId: string, dateISO: string) {
  const day = new Date(`${dateISO}T00:00:00`);
  if (isNaN(day.getTime())) return null;
  const next = new Date(day.getTime() + 24 * 3600_000);
  return prisma.appointment.findMany({
    where: {
      workspaceId,
      status: { not: "cancelada" },
      startsAt: { gte: day, lt: next },
    },
    orderBy: { startsAt: "asc" },
    select: { startsAt: true, durationMin: true },
  });
}

// Crea la cita, vincula/crea el contacto y lo mueve a la columna "citas".
export async function bookAppointment(opts: {
  workspaceId: string;
  customerName: string;
  customerPhone?: string | null;
  datetimeISO: string;
  durationMin?: number;
  notes?: string;
  source: "whatsapp" | "llamada" | "manual";
  callId?: string;
}): Promise<BookingResult> {
  const startsAt = new Date(opts.datetimeISO);
  if (isNaN(startsAt.getTime())) {
    return { ok: false, error: "Fecha/hora no válida. Usa formato ISO, p.ej. 2026-08-10T17:00:00" };
  }
  const settings = await getWorkspaceSettings(opts.workspaceId);
  const durationMin = opts.durationMin ?? settings.sonia.slotMinutes ?? 30;

  const conflicts = await findConflicts(opts.workspaceId, startsAt, durationMin);
  if (conflicts.length > 0) {
    return {
      ok: false,
      error: "Ese horario ya está ocupado",
      conflicts: conflicts.map((c) => ({
        startsAt: c.startsAt.toISOString(),
        durationMin: c.durationMin,
      })),
    };
  }

  let contactId: string | undefined;
  if (opts.customerPhone) {
    const contact = await findOrCreateContactByPhone({
      workspaceId: opts.workspaceId,
      phone: opts.customerPhone,
      name: opts.customerName,
      source: opts.source,
    });
    contactId = contact.id;
  }

  const appointment = await prisma.appointment.create({
    data: {
      workspaceId: opts.workspaceId,
      contactId,
      customerName: opts.customerName,
      customerPhone: opts.customerPhone ?? null,
      startsAt,
      durationMin,
      notes: opts.notes,
      source: opts.source,
      callId: opts.callId,
      status: "confirmada",
    },
  });

  if (contactId) await moveContactToStage(contactId, "citas");

  return { ok: true, appointmentId: appointment.id, startsAt: startsAt.toISOString() };
}

export async function cancelAppointmentByPhoneAndTime(opts: {
  workspaceId: string;
  customerPhone: string;
  datetimeISO: string;
}): Promise<{ ok: boolean; error?: string }> {
  const startsAt = new Date(opts.datetimeISO);
  if (isNaN(startsAt.getTime())) return { ok: false, error: "Fecha no válida" };
  const windowStart = new Date(startsAt.getTime() - 60 * 60_000);
  const windowEnd = new Date(startsAt.getTime() + 60 * 60_000);
  const digits = opts.customerPhone.replace(/\D/g, "").slice(-9);
  const appt = await prisma.appointment.findFirst({
    where: {
      workspaceId: opts.workspaceId,
      status: { not: "cancelada" },
      startsAt: { gte: windowStart, lte: windowEnd },
      customerPhone: { contains: digits },
    },
  });
  if (!appt) return { ok: false, error: "No se encontró ninguna cita con ese teléfono y horario" };
  await prisma.appointment.update({
    where: { id: appt.id },
    data: { status: "cancelada" },
  });
  return { ok: true };
}
