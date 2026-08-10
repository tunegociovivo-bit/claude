const MADRID = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

function parts(date: Date) {
  const values = Object.fromEntries(MADRID.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function madridMidnight(year: number, month: number, day: number): Date {
  const desiredAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = new Date(desiredAsUtc);
  // Dos iteraciones resuelven también los días de cambio CET/CEST.
  for (let attempt = 0; attempt < 3; attempt++) {
    const observed = parts(guess);
    const observedAsUtc = Date.UTC(
      observed.year, observed.month - 1, observed.day,
      observed.hour, observed.minute, observed.second
    );
    const correction = desiredAsUtc - observedAsUtc;
    if (correction === 0) break;
    guess = new Date(guess.getTime() + correction);
  }
  return guess;
}

/** Inicio del día civil actual de Madrid expresado como instante UTC. */
export function startOfMadridBusinessDay(now = new Date()): Date {
  const local = parts(now);
  return madridMidnight(local.year, local.month, local.day);
}

export function madridBusinessDayWindow(now = new Date(), lookbackDays = 0): { start: Date; end: Date } {
  const local = parts(now);
  const startCalendar = new Date(Date.UTC(local.year, local.month - 1, local.day - lookbackDays));
  const endCalendar = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
  return {
    start: madridMidnight(startCalendar.getUTCFullYear(), startCalendar.getUTCMonth() + 1, startCalendar.getUTCDate()),
    end: madridMidnight(endCalendar.getUTCFullYear(), endCalendar.getUTCMonth() + 1, endCalendar.getUTCDate())
  };
}
