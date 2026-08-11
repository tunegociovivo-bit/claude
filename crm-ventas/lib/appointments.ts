import { prisma } from "@/lib/prisma";
import { findOrCreateContactByPhone, moveContactToStage } from "@/lib/contacts";
import { getWorkspaceSettings } from "@/lib/settings";
import { syncAppointmentToGoogle } from "@/lib/google-calendar";

export type BookingResult =
  | { ok: true; appointmentId: string; startsAt: string }
  | { ok: false; error: string; conflicts?: { startsAt: string; durationMin: number }[] };

const BUSINESS_TIME_ZONE = "Europe/Madrid";

export function zonedDateTime(dateISO: string, hour: number, minute: number): Date {
  const [year, month, day] = dateISO.split("-").map(Number);
  if (!year || !month || !day) return new Date(NaN);
  const desiredWallTime = Date.UTC(year, month - 1, day, hour, minute);
  let instant = new Date(desiredWallTime);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: BUSINESS_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    const actualWallTime = Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour"),
      value("minute")
    );
    instant = new Date(instant.getTime() + desiredWallTime - actualWallTime);
  }
  const roundTrip = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const roundTripValue = (type: Intl.DateTimeFormatPartTypes) =>
    Number(roundTrip.find((part) => part.type === type)?.value ?? 0);
  if (
    roundTripValue("year") !== year ||
    roundTripValue("month") !== month ||
    roundTripValue("day") !== day ||
    roundTripValue("hour") !== hour ||
    roundTripValue("minute") !== minute
  ) return new Date(NaN);
  return instant;
}

export function parseAppointmentDateTime(value: string): Date {
  // Tool calls describe the business's wall-clock time. Some voice models append
  // `Z` even though they still mean 10:00 in Madrid, not 10:00 UTC.
  const localMatch = value.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/
  );
  return localMatch
    ? zonedDateTime(localMatch[1], Number(localMatch[2]), Number(localMatch[3]))
    : new Date(value);
}

function businessDateISO(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

// Citas existentes que solapan el intervalo pedido.
export async function findConflicts(
  workspaceId: string,
  startsAt: Date,
  durationMin: number,
  db: any = prisma
) {
  const end = new Date(startsAt.getTime() + durationMin * 60_000);
  const dayStart = new Date(startsAt.getTime() - 24 * 3600_000);
  const candidates = await db.appointment.findMany({
    where: {
      workspaceId,
      status: { not: "cancelada" },
      startsAt: { gte: dayStart, lt: end },
    },
    orderBy: { startsAt: "asc" },
    take: 50,
  });
  return candidates.filter((a: { startsAt: Date; durationMin: number }) => {
    const aEnd = new Date(a.startsAt.getTime() + a.durationMin * 60_000);
    return a.startsAt < end && aEnd > startsAt;
  });
}

// Citas de un día (para que SONIA sepa qué huecos están ocupados).
export async function appointmentsOfDay(workspaceId: string, dateISO: string, db: any = prisma) {
  const day = zonedDateTime(dateISO, 0, 0);
  if (isNaN(day.getTime())) return null;
  const nextDate = new Date(`${dateISO}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const nextISO = nextDate.toISOString().slice(0, 10);
  const next = zonedDateTime(nextISO, 0, 0);
  return db.appointment.findMany({
    where: {
      workspaceId,
      status: { not: "cancelada" },
      startsAt: { gte: day, lt: next },
    },
    orderBy: { startsAt: "asc" },
    select: { startsAt: true, durationMin: true },
  });
}

export function openingRanges(
  openingHours: string,
  dateISO: string
): Array<{ startMinutes: number; endMinutes: number }> {
  const normalized = openingHours
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(sabados|domingos)\b/g, (day) => day.slice(0, -1));
  const dayOfWeek = new Date(`${dateISO}T12:00:00Z`).getUTCDay();
  const dayNames = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
  const hasDaySpecificRules = dayNames.some((day) => normalized.includes(day));
  const segments = normalized
    .split(/[;\n]+/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const applicable = segments.filter((segment) => {
    const namedDays = dayNames
      .map((name, index) => ({ name, index }))
      .filter(({ name }) => new RegExp(`\\b${name}\\b`).test(segment));
    if (!namedDays.length) return !hasDaySpecificRules;
    const dayRange = segment.match(
      /\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\s*(?:a|-)\s*(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/
    );
    if (dayRange) {
      const start = dayNames.indexOf(dayRange[1]);
      const end = dayNames.indexOf(dayRange[2]);
      if (start <= end) return dayOfWeek >= start && dayOfWeek <= end;
      return dayOfWeek >= start || dayOfWeek <= end;
    }
    return namedDays.some(({ index }) => index === dayOfWeek);
  });
  if (!applicable.length || applicable.some((segment) => segment.includes("cerrado"))) return [];

  const ranges = [...applicable.join(" ").matchAll(/(\d{1,2})(?::(\d{2}))?\s*(?:a|[-–])\s*(\d{1,2})(?::(\d{2}))?/gi)]
    .map((match) => ({
      startMinutes: Number(match[1]) * 60 + Number(match[2] ?? 0),
      endMinutes: Number(match[3]) * 60 + Number(match[4] ?? 0),
    }))
    .filter((range) => range.startMinutes >= 0 && range.endMinutes <= 24 * 60 && range.endMinutes > range.startMinutes);
  return ranges.length
    ? ranges
    : hasDaySpecificRules
      ? []
      : [{ startMinutes: 9 * 60, endMinutes: 18 * 60 }];
}

// Devuelve únicamente horas de inicio en las que cabe el servicio completo.
// Así el modelo no tiene que deducir solapes ni ofrecer huecos parciales.
export async function availableSlotsOfDay(opts: {
  workspaceId: string;
  dateISO: string;
  durationMin: number;
  openingHours: string;
  stepMin?: number;
  db?: any;
}): Promise<string[] | null> {
  const appointments = await appointmentsOfDay(opts.workspaceId, opts.dateISO, opts.db ?? prisma);
  if (appointments === null) return null;
  const ranges = openingRanges(opts.openingHours, opts.dateISO);
  const stepMin = opts.stepMin ?? 30;
  const slots: string[] = [];

  for (const { startMinutes, endMinutes } of ranges) {
    for (let minute = startMinutes; minute + opts.durationMin <= endMinutes; minute += stepMin) {
      const startsAt = zonedDateTime(
        opts.dateISO,
        Math.floor(minute / 60),
        minute % 60
      );
      const endsAt = new Date(startsAt.getTime() + opts.durationMin * 60_000);
      const overlaps = appointments.some((appointment: { startsAt: Date; durationMin: number }) => {
        const appointmentEnd = new Date(
          appointment.startsAt.getTime() + appointment.durationMin * 60_000
        );
        return appointment.startsAt < endsAt && appointmentEnd > startsAt;
      });
      if (!overlaps) {
        const hours = String(Math.floor(minute / 60)).padStart(2, "0");
        const minutes = String(minute % 60).padStart(2, "0");
        slots.push(`${opts.dateISO}T${hours}:${minutes}:00`);
      }
    }
  }
  return slots;
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
  openingHours?: string;
}): Promise<BookingResult> {
  const startsAt = parseAppointmentDateTime(opts.datetimeISO);
  if (isNaN(startsAt.getTime())) {
    return { ok: false, error: "Fecha/hora no válida. Usa formato ISO, p.ej. 2026-08-10T17:00:00" };
  }
  const settings = await getWorkspaceSettings(opts.workspaceId);
  const durationMin = opts.durationMin ?? settings.sonia.slotMinutes ?? 30;

  if (!Number.isInteger(durationMin) || durationMin < 15 || durationMin > 240) {
    return { ok: false, error: "La duración debe estar entre 15 y 240 minutos" };
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

  const dateISO = businessDateISO(startsAt);
  const result: BookingResult = await prisma.$transaction(async (tx: any): Promise<BookingResult> => {
    await tx.$queryRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      `${opts.workspaceId}:${dateISO}`
    );
    const existing = opts.customerPhone
      ? await tx.appointment.findFirst({
          where: {
            workspaceId: opts.workspaceId,
            customerPhone: opts.customerPhone,
            startsAt,
            durationMin,
            status: { not: "cancelada" },
          },
          select: { id: true, startsAt: true },
        })
      : null;
    if (existing) {
      return { ok: true, appointmentId: existing.id, startsAt: existing.startsAt.toISOString() };
    }
    const available = await availableSlotsOfDay({
      workspaceId: opts.workspaceId,
      dateISO,
      durationMin,
      openingHours: opts.openingHours ?? settings.sonia.openingHours,
      db: tx,
    });
    const isAvailable = available?.some(
      (slot) => parseAppointmentDateTime(slot).getTime() === startsAt.getTime()
    );
    if (!isAvailable) {
      const conflicts = await findConflicts(opts.workspaceId, startsAt, durationMin, tx);
      return {
        ok: false,
        error: "Ese horario no está disponible para la duración completa solicitada",
        conflicts: conflicts.map((c: { startsAt: Date; durationMin: number }) => ({
          startsAt: c.startsAt.toISOString(),
          durationMin: c.durationMin,
        })),
      };
    }
    const appointment = await tx.appointment.create({
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
    return { ok: true, appointmentId: appointment.id, startsAt: startsAt.toISOString() };
  }, { timeout: 10_000 });

  if (result.ok && contactId) await moveContactToStage(contactId, "citas");
  if (result.ok) {
    await syncAppointmentToGoogle(opts.workspaceId, result.appointmentId).catch((error) =>
      console.error("[google-calendar] sincronización de cita:", error)
    );
  }

  return result;
}

export async function cancelAppointmentByPhoneAndTime(opts: {
  workspaceId: string;
  customerPhone: string;
  datetimeISO: string;
}): Promise<{ ok: boolean; error?: string }> {
  const startsAt = parseAppointmentDateTime(opts.datetimeISO);
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
  await syncAppointmentToGoogle(opts.workspaceId, appt.id).catch((error) =>
    console.error("[google-calendar] cancelación:", error)
  );
  return { ok: true };
}
