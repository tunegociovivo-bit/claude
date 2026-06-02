/**
 * Recurrencia de tareas (sobre todo tareas de Sonia que se relanzan solas).
 * Valores: none | daily | every_2_days | weekly | biweekly | monthly
 */

export const RECURRENCE_OPTIONS = [
  { value: "none", label: "No repetir" },
  { value: "daily", label: "Cada día" },
  { value: "every_2_days", label: "Cada 2 días" },
  { value: "weekly", label: "Cada semana" },
  { value: "biweekly", label: "Cada 2 semanas" },
  { value: "monthly", label: "Cada mes" },
  { value: "every_2_months", label: "Cada 2 meses" },
  { value: "every_6_months", label: "Cada 6 meses" },
  { value: "yearly", label: "Cada año" }
] as const;

export type Recurrence = (typeof RECURRENCE_OPTIONS)[number]["value"];

const DAY_MS = 24 * 60 * 60 * 1000;

export function isValidRecurrence(v: unknown): v is Recurrence {
  return typeof v === "string" && RECURRENCE_OPTIONS.some((o) => o.value === v);
}

/** Avanza una fecha un periodo de recurrencia. */
function advance(date: Date, recurrence: Recurrence): Date {
  const d = new Date(date);
  switch (recurrence) {
    case "daily":
      return new Date(d.getTime() + DAY_MS);
    case "every_2_days":
      return new Date(d.getTime() + 2 * DAY_MS);
    case "weekly":
      return new Date(d.getTime() + 7 * DAY_MS);
    case "biweekly":
      return new Date(d.getTime() + 14 * DAY_MS);
    case "monthly": {
      d.setMonth(d.getMonth() + 1);
      return d;
    }
    case "every_2_months": {
      d.setMonth(d.getMonth() + 2);
      return d;
    }
    case "every_6_months": {
      d.setMonth(d.getMonth() + 6);
      return d;
    }
    case "yearly": {
      d.setFullYear(d.getFullYear() + 1);
      return d;
    }
    default:
      return d;
  }
}

/**
 * Calcula la próxima ejecución (estrictamente futura). `anchor` es la
 * fecha/hora base (p.ej. la fecha de entrega de la tarea); si no hay,
 * se ancla en `now`. Devuelve null si recurrence === "none".
 */
export function computeRecurrenceNext(
  recurrence: Recurrence,
  anchor: Date | null,
  now: Date = new Date()
): Date | null {
  if (recurrence === "none") return null;
  let next = anchor ? new Date(anchor) : advance(now, recurrence);
  // Avanza hasta que quede en el futuro (cap defensivo de iteraciones).
  let guard = 0;
  while (next <= now && guard < 1000) {
    next = advance(next, recurrence);
    guard++;
  }
  return next;
}
