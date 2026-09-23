"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export async function api<T = any>(path: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? "GET", headers: {} };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body !== undefined) {
    (init.headers as any)["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  const r = await fetch(`/api/v1/seo-blog${path}`, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error?.message ?? d?.message ?? (typeof d?.error === "string" ? d.error : null) ?? `Error ${r.status}`);
  return d as T;
}

export const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  propuesta: { label: "Propuesta", cls: "bg-slate-100 text-slate-600 ring-slate-200", dot: "#94a3b8" },
  planificada: { label: "Planificada", cls: "bg-blue-50 text-blue-700 ring-blue-200", dot: "#3b82f6" },
  en_cola: { label: "En cola", cls: "bg-violet-50 text-violet-700 ring-violet-200", dot: "#8b5cf6" },
  generando: { label: "Generando", cls: "bg-violet-50 text-violet-700 ring-violet-200", dot: "#8b5cf6" },
  revision: { label: "En revisión", cls: "bg-amber-50 text-amber-700 ring-amber-200", dot: "#f59e0b" },
  aprobada: { label: "Aprobada", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "#10b981" },
  programada: { label: "Programada", cls: "bg-teal-50 text-teal-700 ring-teal-200", dot: "#0d9488" },
  publicada: { label: "Publicada", cls: "bg-green-50 text-green-700 ring-green-200", dot: "#16a34a" },
  error: { label: "Error", cls: "bg-rose-50 text-rose-700 ring-rose-200", dot: "#e11d48" },
  descartada: { label: "Descartada", cls: "bg-slate-50 text-slate-400 ring-slate-200", dot: "#cbd5e1" }
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.propuesta;
  return <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap", s.cls)}>{s.label}</span>;
}

export function Score({ value, big }: { value: number; big?: boolean }) {
  if (!value) return null;
  const cls = value >= 85 ? "bg-emerald-100 text-emerald-700" : value >= 70 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700";
  return (
    <span className={clsx("inline-grid place-items-center rounded-full font-semibold", cls, big ? "h-10 min-w-10 px-2 text-base" : "h-6 min-w-8 px-2 text-xs")} title="Puntuación SEO">
      {value}
    </span>
  );
}

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={clsx("bg-white rounded-xl border p-4 sm:p-5", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          {title && <h3 className="font-semibold text-slate-800">{title}</h3>}
          {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Btn({
  children, variant = "primary", size = "md", busy, className, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "ok" | "danger"; size?: "sm" | "md"; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={busy || rest.disabled}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        variant === "primary" && "bg-slate-900 text-white hover:bg-slate-800",
        variant === "ghost" && "bg-white border text-slate-700 hover:bg-slate-50",
        variant === "ok" && "bg-emerald-600 text-white hover:bg-emerald-700",
        variant === "danger" && "bg-white border border-rose-200 text-rose-600 hover:bg-rose-50",
        className
      )}
    >
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function Field({ label, help, children, wide }: { label: string; help?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={clsx("flex flex-col gap-1 text-xs font-medium text-slate-700", wide && "sm:col-span-2 lg:col-span-3")}>
      {label}
      {children}
      {help && <span className="font-normal text-[11px] text-slate-500">{help}</span>}
    </label>
  );
}

export const inputCls = "w-full px-3 py-2 rounded-lg border text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-300/60 focus:border-amber-400";

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed bg-slate-50/50 p-6 text-center text-sm text-slate-500">{children}</div>;
}

export const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  const x = new Date(d);
  return (
    x.toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "short", timeZone: "Europe/Madrid" }) +
    " · " +
    x.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" })
  );
};

export const todayISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
