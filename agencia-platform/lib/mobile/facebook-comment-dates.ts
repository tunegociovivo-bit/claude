const DAY = 86_400_000;

/** Conservative earliest possible time for Facebook's rounded date labels. */
export function facebookCommentDate(label: string, reference: number): number | null {
  const text = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\.$/, "");
  const midnight = new Date(reference); midnight.setUTCHours(0, 0, 0, 0);
  if (/^(ahora|justo ahora|just now|now)$/.test(text)) return reference - 60_000;
  if (/^(hoy|today)$/.test(text)) return midnight.getTime();
  if (/^(ayer|yesterday)$/.test(text)) return midnight.getTime() - DAY;
  const relative = text.match(/^(?:hace\s+)?(\d+)\s*(s|seg|segundos?|seconds?|m|min|minutos?|minutes?|h|horas?|hours?|d|dias?|days?|sem|semanas?|w|weeks?|mes|meses|months?|a|anos?|years?)(?:\s+ago)?$/);
  if (relative) {
    const unit = relative[2];
    const scale = /^(s|seg|segundo|second)/.test(unit) && !/^sem/.test(unit) ? 1000
      : /^(m|min)$|^(minuto|minute)/.test(unit) ? 60_000 : /^(h)/.test(unit) ? 3_600_000
      : /^(d)/.test(unit) ? DAY : /^(sem|w)/.test(unit) ? 7 * DAY
      : /^(mes|month)/.test(unit) ? 31 * DAY : 366 * DAY;
    return reference - (Number(relative[1]) + 1) * scale;
  }
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const absolute = text.match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)(?:\s+(?:de\s+)?(\d{4}))?(?:\s+a las\s+\d{1,2}:\d{2})?$/);
  if (!absolute) return null;
  const month = absolute[2] === "sept" ? 8 : months.findIndex((name) => name === absolute[2] || name.slice(0, 3) === absolute[2]);
  if (month < 0) return null;
  let year = absolute[3] ? Number(absolute[3]) : new Date(reference).getUTCFullYear();
  let date = Date.UTC(year, month, Number(absolute[1]));
  if (!absolute[3] && date > reference) date = Date.UTC(--year, month, Number(absolute[1]));
  const parsed = new Date(date);
  return parsed.getUTCMonth() === month && parsed.getUTCDate() === Number(absolute[1]) ? date : null;
}

export function commentWithinPeriod(label: string, days: number, reference: number): boolean {
  const date = facebookCommentDate(label, reference);
  return date !== null && date >= reference - days * DAY && date <= reference;
}

/** Calendar-date limits are inclusive; rounded relative labels must fit wholly in the range. */
export function commentWithinDateRange(label: string, from: string, to: string, reference: number): boolean {
  const earliest = facebookCommentDate(label, reference);
  if (earliest === null || earliest > reference) return false;
  const normalized = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const relative = /^(?:hace\s+)?(\d+)\s*(?:s|seg|segundos?|seconds?|m|min|minutos?|minutes?|h|horas?|hours?|d|dias?|days?|sem|semanas?|w|weeks?|mes|meses|months?|a|anos?|years?)(?:\s+ago)?\.?$/.exec(normalized);
  const day = (time: number) => new Date(time).toISOString().slice(0, 10);
  const latest = relative ? reference - (reference - earliest) * Number(relative[1]) / (Number(relative[1]) + 1) : earliest;
  return day(earliest) >= from && day(latest) <= to;
}
