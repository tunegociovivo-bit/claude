function localClock(now: Date, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("es-ES", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);
  const value = (type: "hour" | "minute") => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { hour: value("hour"), minute: value("minute") };
}

/**
 * Detecta encargos que contienen una hora futura explícita. El objetivo no es
 * interpretar todo el calendario aquí, sino impedir que el agente ejecute el
 * trabajo durante la conversación que debía limitarse a programarlo.
 */
export function hasFutureExecutionIntent(
  text: string,
  now = new Date(),
  timeZone = "Europe/Madrid"
): boolean {
  const normalized = text.toLocaleLowerCase("es-ES");
  const hasClock = /\b(?:a\s+las?|sobre\s+las?)\s+([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\b/.test(normalized);
  if (!hasClock) return false;

  if (/\b(mañana|pasado\s+mañana|próxim[oa]|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\b/.test(normalized)) {
    return true;
  }

  const todayMatch = normalized.match(/\bhoy\b[\s\S]{0,80}?\b(?:a\s+las?|sobre\s+las?)\s+([01]?\d|2[0-3])(?:[:.]([0-5]\d))?/);
  if (todayMatch) {
    const requestedMinutes = Number(todayMatch[1]) * 60 + Number(todayMatch[2] ?? 0);
    const current = localClock(now, timeZone);
    return requestedMinutes > current.hour * 60 + current.minute;
  }

  // Una fecha de calendario acompañada de una hora es un encargo programado.
  return /\b(?:el\s+)?\d{1,2}(?:[/-]\d{1,2}|\s+de\s+[a-záéíóúñ]+)\b/.test(normalized);
}
