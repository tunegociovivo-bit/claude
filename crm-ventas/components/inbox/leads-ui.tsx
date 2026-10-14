"use client";

import clsx from "clsx";

export type LeadStatusOption = { id: string; label: string; color: string };
export type ForwardTargetOption = { id: string; label: string; phone: string };
export type LeadsUi = { enabled: boolean; statuses: LeadStatusOption[]; forwardTargets: ForwardTargetOption[] };

export const EMPTY_LEADS: LeadsUi = { enabled: false, statuses: [], forwardTargets: [] };

// Clases estáticas (Tailwind no ve clases construidas dinámicamente).
export const LEAD_TONE: Record<string, { dot: string; chip: string; select: string }> = {
  slate: { dot: "bg-slate-400", chip: "bg-slate-100 text-slate-700", select: "border-slate-300 bg-slate-50 text-slate-800" },
  sky: { dot: "bg-sky-500", chip: "bg-sky-50 text-sky-700", select: "border-sky-300 bg-sky-50 text-sky-800" },
  amber: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-800", select: "border-amber-300 bg-amber-50 text-amber-900" },
  emerald: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700", select: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  rose: { dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700", select: "border-rose-300 bg-rose-50 text-rose-800" },
  violet: { dot: "bg-violet-500", chip: "bg-violet-50 text-violet-700", select: "border-violet-300 bg-violet-50 text-violet-800" },
  orange: { dot: "bg-orange-500", chip: "bg-orange-50 text-orange-700", select: "border-orange-300 bg-orange-50 text-orange-800" },
  zinc: { dot: "bg-zinc-500", chip: "bg-zinc-100 text-zinc-600", select: "border-zinc-300 bg-zinc-100 text-zinc-700" },
};

export const LEAD_COLOR_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "slate", label: "Gris" },
  { id: "sky", label: "Azul" },
  { id: "amber", label: "Amarillo" },
  { id: "orange", label: "Naranja" },
  { id: "emerald", label: "Verde" },
  { id: "violet", label: "Morado" },
  { id: "rose", label: "Rojo" },
  { id: "zinc", label: "Oscuro" },
];

export function toneOf(color: string | undefined) {
  return LEAD_TONE[color ?? ""] ?? LEAD_TONE.slate;
}

export function findStatus(statuses: LeadStatusOption[], id: string | null | undefined) {
  if (!id) return null;
  return statuses.find((s) => s.id === id) ?? { id, label: "Estado eliminado", color: "zinc" };
}

export function LeadStatusChip({ status, className }: { status: LeadStatusOption | null; className?: string }) {
  if (!status) return null;
  const tone = toneOf(status.color);
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold", tone.chip, className)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", tone.dot)} aria-hidden />
      {status.label}
    </span>
  );
}

// Desplegable nativo (en el móvil abre el selector del sistema) con el color del estado.
export function LeadStatusSelect({
  statuses,
  value,
  onChange,
  disabled,
  className,
  ariaLabel = "Estado del lead",
}: {
  statuses: LeadStatusOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const current = findStatus(statuses, value);
  const tone = toneOf(current?.color);
  const known = !value || statuses.some((s) => s.id === value);
  return (
    <span className={clsx("relative inline-flex min-w-0 items-center", className)}>
      <span className={clsx("pointer-events-none absolute left-3 h-2.5 w-2.5 rounded-full", current ? tone.dot : "bg-slate-200 ring-1 ring-slate-300")} aria-hidden />
      <select
        aria-label={ariaLabel}
        className={clsx(
          "h-10 w-full min-w-0 appearance-none truncate rounded-full border py-0 pl-8 pr-8 text-sm font-semibold outline-none focus:ring-2 focus:ring-brand-100 disabled:opacity-60",
          current ? tone.select : "border-slate-300 bg-white text-slate-500"
        )}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Sin estado</option>
        {statuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
        {!known && value && <option value={value}>Estado eliminado</option>}
      </select>
      <svg className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-current opacity-60" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
      </svg>
    </span>
  );
}

export function forwardButtonLabel(label: string) {
  return `ENVIAR A ${label.toLocaleUpperCase("es-ES")}`;
}
