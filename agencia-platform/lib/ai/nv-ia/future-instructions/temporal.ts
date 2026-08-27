/**
 * Resolución DETERMINISTA de expresiones temporales en español a instantes
 * UTC, proyectadas en una zona horaria IANA (por defecto Europe/Madrid).
 *
 * División de responsabilidades del planificador de instrucciones futuras:
 * el LLM solo ENTIENDE el lenguaje y devuelve un WhenSpec estructurado
 * ("mañana", "viernes", "09:00"…); TODA la aritmética de fechas (zona
 * horaria, DST, cambio de mes/año, coherencia día-de-semana) vive aquí,
 * en funciones puras sin dependencias — testeables sin red ni BD.
 */

export type WhenSpec = {
  /** Fecha absoluta "YYYY-MM-DD" si el usuario la dio explícita. */
  dateIso?: string | null;
  /** Palabra relativa de día. */
  dayWord?: "hoy" | "mañana" | "pasado mañana" | null;
  /** Día de la semana en minúsculas y sin acentos opcionales ("miercoles"). */
  weekday?: string | null;
  /** "dentro de N unidades". */
  inAmount?: number | null;
  inUnit?: "minutes" | "hours" | "days" | "weeks" | null;
  /** Hora local "HH:MM" (24h). */
  time?: string | null;
  /** Texto original de la expresión, para mensajes al usuario. */
  raw?: string | null;
};

export type ResolvedWhen =
  | { ok: true; atUtc: Date; wallClock: string; timeZone: string }
  | {
      ok: false;
      reason: "past" | "ambiguous" | "needs_time" | "invalid";
      detail: string;
      /** Ajuste que proponemos al usuario (si lo hay), ya resuelto. */
      proposedUtc?: Date;
      proposedWallClock?: string;
    };

const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizeWeekday(word: string): number | null {
  const w = stripAccents(word.trim().toLowerCase());
  const idx = WEEKDAYS.indexOf(w);
  return idx >= 0 ? idx : null;
}

type WallParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

/** Partes de fecha-pared de un instante UTC proyectado a `timeZone`. */
export function wallPartsInTz(date: Date, timeZone: string): WallParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday as string] ?? 0;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl puede devolver "24" para medianoche con hour12:false.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: wd
  };
}

/** Offset (ms) de `timeZone` respecto a UTC en el instante dado. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const p = wallPartsInTz(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/**
 * Convierte una fecha-pared (año/mes/día HH:MM en `timeZone`) al instante UTC.
 * Maneja DST por iteración de offset: para horas inexistentes (salto de
 * primavera) devuelve el instante desplazado por el hueco; para horas
 * ambiguas (repetidas en otoño) devuelve la PRIMERA ocurrencia.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let ts = utcGuess - tzOffsetMs(new Date(utcGuess), timeZone);
  // Segunda pasada: si el offset cambió entre el guess y el resultado
  // (frontera DST), reajusta con el offset del propio resultado.
  ts = utcGuess - tzOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

/** "27/08/2026 09:00 (Europe/Madrid)" — para confirmaciones al usuario. */
export function formatWallClock(date: Date, timeZone: string): string {
  const p = wallPartsInTz(date, timeZone);
  const dd = String(p.day).padStart(2, "0");
  const mm = String(p.month).padStart(2, "0");
  const hh = String(p.hour).padStart(2, "0");
  const mi = String(p.minute).padStart(2, "0");
  const wd = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][p.weekday];
  return `${wd} ${dd}/${mm}/${p.year} ${hh}:${mi} (${timeZone})`;
}

function parseTime(time: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(time.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Suma días a una fecha-pared (aritmética de calendario vía Date.UTC). */
function addDaysToWall(p: { year: number; month: number; day: number }, days: number) {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days, 12, 0, 0));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}

/**
 * Resuelve un WhenSpec a instante UTC tomando `baseUtc` como "ahora".
 *
 * Reglas de coherencia (requisito: nunca ejecutar en silencio otra cosa):
 * - dayWord + weekday que NO casan ("mañana jueves" cuando mañana es viernes)
 *   → ambiguous, con la resolución del weekday como propuesta.
 * - weekday solo → SIGUIENTE ocurrencia estrictamente futura (1..7 días).
 * - Sin hora y sin "dentro de N" → needs_time (no inventamos las 00:00).
 * - Resultado ya pasado → past, proponiendo el día siguiente a esa hora si
 *   la expresión era relativa a hora del día.
 */
export function resolveWhen(spec: WhenSpec, baseUtc: Date, timeZone: string): ResolvedWhen {
  const raw = spec.raw ?? "";
  // "dentro de N unidades": aritmética directa sobre el instante.
  if (spec.inAmount != null && spec.inUnit) {
    if (!(spec.inAmount > 0)) return { ok: false, reason: "invalid", detail: `Cantidad inválida en «${raw}»` };
    const ms =
      spec.inUnit === "minutes" ? spec.inAmount * 60_000 :
      spec.inUnit === "hours" ? spec.inAmount * 3_600_000 :
      spec.inUnit === "days" ? spec.inAmount * 86_400_000 :
      spec.inAmount * 7 * 86_400_000;
    const atUtc = new Date(baseUtc.getTime() + ms);
    return { ok: true, atUtc, wallClock: formatWallClock(atUtc, timeZone), timeZone };
  }

  const base = wallPartsInTz(baseUtc, timeZone);
  let target: { year: number; month: number; day: number; weekday?: number } | null = null;

  if (spec.dateIso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(spec.dateIso.trim());
    if (!m) return { ok: false, reason: "invalid", detail: `Fecha inválida «${spec.dateIso}»` };
    target = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  }

  const dayWordOffset = spec.dayWord === "hoy" ? 0 : spec.dayWord === "mañana" ? 1 : spec.dayWord === "pasado mañana" ? 2 : null;
  if (dayWordOffset != null && !target) {
    target = addDaysToWall(base, dayWordOffset);
  }

  const weekdayIdx = spec.weekday ? normalizeWeekday(spec.weekday) : null;
  if (spec.weekday && weekdayIdx == null) {
    return { ok: false, reason: "invalid", detail: `Día de la semana no reconocido «${spec.weekday}»` };
  }

  if (weekdayIdx != null) {
    if (target) {
      // Coherencia: la fecha ya elegida (dayWord o dateIso) debe caer en ese
      // día de la semana; si no, es ambigua y proponemos el weekday.
      const t = addDaysToWall({ year: target.year, month: target.month, day: target.day }, 0);
      if (t.weekday !== weekdayIdx) {
        const delta = ((weekdayIdx - base.weekday) + 7) % 7 || 7;
        const prop = addDaysToWall(base, delta);
        const time = spec.time ? parseTime(spec.time) : null;
        const proposedUtc = time
          ? zonedTimeToUtc(prop.year, prop.month, prop.day, time.hour, time.minute, timeZone)
          : undefined;
        return {
          ok: false,
          reason: "ambiguous",
          detail:
            `«${raw || `${spec.dayWord ?? spec.dateIso} ${spec.weekday}`}»: ` +
            `esa fecha cae en ${["domingo","lunes","martes","miércoles","jueves","viernes","sábado"][t.weekday]}, no en ${spec.weekday}`,
          proposedUtc,
          proposedWallClock: proposedUtc ? formatWallClock(proposedUtc, timeZone) : undefined
        };
      }
    } else {
      // Solo weekday → siguiente ocurrencia estrictamente futura.
      const delta = ((weekdayIdx - base.weekday) + 7) % 7 || 7;
      target = addDaysToWall(base, delta);
    }
  }

  if (!target) return { ok: false, reason: "invalid", detail: `No hay fecha reconocible en «${raw}»` };

  if (!spec.time) {
    return {
      ok: false,
      reason: "needs_time",
      detail: `«${raw}»: falta la hora — no programo a una hora inventada`
    };
  }
  const time = parseTime(spec.time);
  if (!time) return { ok: false, reason: "invalid", detail: `Hora inválida «${spec.time}»` };

  const atUtc = zonedTimeToUtc(target.year, target.month, target.day, time.hour, time.minute, timeZone);
  if (atUtc.getTime() <= baseUtc.getTime()) {
    const nextDay = addDaysToWall({ year: target.year, month: target.month, day: target.day }, 1);
    const proposedUtc = zonedTimeToUtc(nextDay.year, nextDay.month, nextDay.day, time.hour, time.minute, timeZone);
    return {
      ok: false,
      reason: "past",
      detail: `«${raw}» resuelve a ${formatWallClock(atUtc, timeZone)}, que ya pasó`,
      proposedUtc,
      proposedWallClock: formatWallClock(proposedUtc, timeZone)
    };
  }
  return { ok: true, atUtc, wallClock: formatWallClock(atUtc, timeZone), timeZone };
}

/** Enmascara un teléfono para confirmaciones: +34680167881 → +34•••••7881. */
export function maskPhone(phone: string): string {
  const p = phone.trim();
  if (p.length <= 7) return p.replace(/\d(?=\d{2})/g, "•");
  return `${p.slice(0, 3)}${"•".repeat(Math.max(3, p.length - 7))}${p.slice(-4)}`;
}

/**
 * Filtro barato previo al LLM: ¿el texto contiene alguna pista temporal de
 * futuro? Si no, el planificador ni se invoca (cero coste añadido en la
 * inmensa mayoría de comentarios).
 */
export function looksLikeFutureInstruction(text: string): boolean {
  const t = stripAccents(text.toLowerCase());
  return (
    /\b(manana|pasado manana|proxim[oa]s?|semana que viene|mes que viene|esta (tarde|noche)|a las \d{1,2}|a la 1\b|\d{1,2}:\d{2}|dentro de \d|el (lunes|martes|miercoles|jueves|viernes|sabado|domingo)|el \d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))\b/.test(
      t
    )
  );
}
