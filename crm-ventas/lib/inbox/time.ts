// Reloj del negocio (Europe/Madrid) para límites diarios y horario de envíos.
const TZ = "Europe/Madrid";

export function madridParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: weekdays.indexOf(get("weekday")), // 0 = domingo
  };
}

// Instante UTC que corresponde a una hora de pared en Madrid.
export function madridWallTime(year: number, month: number, day: number, hour: number, minute = 0): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let instant = guess;
  for (let i = 0; i < 2; i++) {
    const p = madridParts(new Date(instant));
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    instant += guess - wall;
  }
  return new Date(instant);
}

export function madridDayStart(now: Date): Date {
  const p = madridParts(now);
  return madridWallTime(p.year, p.month, p.day, 0, 0);
}

// Próximo instante dentro de la franja [startHour, endHour) en días permitidos.
export function nextWindowStart(
  now: Date,
  opts: { startHour: number; endHour: number; days: number[] }
): Date {
  const p = madridParts(now);
  if (opts.days.includes(p.weekday) && p.hour >= opts.startHour && p.hour < opts.endHour) return now;
  for (let offset = 0; offset < 8; offset++) {
    const seed = new Date(Date.UTC(p.year, p.month - 1, p.day + offset, 12));
    const weekday = seed.getUTCDay();
    if (!opts.days.includes(weekday)) continue;
    const candidate = madridWallTime(
      seed.getUTCFullYear(),
      seed.getUTCMonth() + 1,
      seed.getUTCDate(),
      opts.startHour
    );
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return new Date(now.getTime() + 24 * 3600_000);
}
