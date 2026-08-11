/**
 * Helpers de presentación (puros) para el panel Cliente 360 (FASE 3b · UI).
 * Sin dependencias de React → testeables.
 */
import type { HealthResult } from "./health";

export function bandLabel(band: HealthResult["band"]): string {
  return band === "good" ? "Saludable" : band === "warn" ? "Atención" : "En riesgo";
}

/** Clases Tailwind por banda (color + texto legible; nunca solo color). */
export function bandClasses(band: HealthResult["band"]): { badge: string; ring: string; dot: string } {
  switch (band) {
    case "good":
      return { badge: "bg-emerald-50 text-emerald-700 border-emerald-200", ring: "text-emerald-600", dot: "bg-emerald-500" };
    case "warn":
      return { badge: "bg-amber-50 text-amber-700 border-amber-200", ring: "text-amber-600", dot: "bg-amber-500" };
    default:
      return { badge: "bg-rose-50 text-rose-700 border-rose-200", ring: "text-rose-600", dot: "bg-rose-500" };
  }
}

export function alertClasses(level: "info" | "warn" | "critical"): string {
  return level === "critical"
    ? "bg-rose-50 text-rose-800 border-rose-200"
    : level === "warn"
    ? "bg-amber-50 text-amber-800 border-amber-200"
    : "bg-slate-50 text-slate-700 border-slate-200";
}

/** Céntimos → "1.234,56 €" (es-ES). */
export function formatEurCents(cents: number): string {
  const n = (Number(cents) || 0) / 100;
  return `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** Días desde la última actividad → texto legible (o "sin datos"). */
export function activityLabel(days: number | null): string {
  if (days === null) return "Sin actividad registrada";
  if (days <= 0) return "Actividad hoy";
  if (days === 1) return "Hace 1 día";
  return `Hace ${days} días`;
}
