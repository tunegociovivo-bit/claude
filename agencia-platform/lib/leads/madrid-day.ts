const MADRID_TZ = "Europe/Madrid";

function madridParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

function madridWallToUtc(year: number, month: number, day: number): Date {
  let guess = new Date(Date.UTC(year, month - 1, day));
  for (let attempt = 0; attempt < 3; attempt++) {
    const actual = madridParts(guess);
    const actualWallAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess = new Date(guess.getTime() + (Date.UTC(year, month - 1, day) - actualWallAsUtc));
  }
  return guess;
}

export function madridDayRange(now = new Date()): { from: Date; to: Date } {
  const today = madridParts(now);
  const nextDay = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  return {
    from: madridWallToUtc(today.year, today.month, today.day),
    to: madridWallToUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate())
  };
}
