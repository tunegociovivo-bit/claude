"use client";

import clsx from "clsx";

export type LineSummary = {
  id: string;
  label: string;
  phone: string | null;
  isPrimary: boolean;
  mode: string;
  active: boolean;
  aiMode: string;
  lastStatus: string | null;
  paused: boolean;
  unreadChats: number;
};

export const STATUS_LABEL: Record<string, string> = {
  WORKING: "Conectado",
  SCAN_QR_CODE: "Esperando QR",
  STARTING: "Arrancando",
  STOPPED: "Parado",
  FAILED: "Con error",
  NO_SESSION: "Sin vincular",
  NOT_CONFIGURED: "Sin aprovisionar",
  UNREACHABLE: "Sin respuesta",
  UNKNOWN: "Desconocido",
};

export const AI_MODE_LABEL: Record<string, string> = {
  auto: "Responde sola",
  suggest: "Propone",
  off: "Apagada",
};

export function statusTone(status: string | null | undefined, paused = false, active = true) {
  if (!active) return "bg-slate-300";
  if (paused) return "bg-orange-500";
  if (status === "WORKING") return "bg-emerald-500";
  if (status === "SCAN_QR_CODE" || status === "STARTING") return "bg-amber-400";
  if (!status) return "bg-slate-300";
  return "bg-red-500";
}

export function StatusDot({ status, paused, active = true, className }: { status: string | null; paused?: boolean; active?: boolean; className?: string }) {
  return <span className={clsx("inline-block h-2 w-2 shrink-0 rounded-full", statusTone(status, paused, active), className)} aria-hidden />;
}

export function lineStatusText(line: { lastStatus: string | null; active: boolean; paused?: boolean; pausedUntil?: string | null }) {
  if (!line.active) return "Desactivado";
  if (line.paused || line.pausedUntil) return "En pausa de seguridad";
  return STATUS_LABEL[line.lastStatus ?? ""] ?? line.lastStatus ?? "Comprobando…";
}

export function formatPhone(phone: string | null | undefined) {
  if (!phone) return "";
  if (phone.includes("@")) return "Número oculto (WhatsApp)";
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("34") && d.length === 11) return `+34 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return `+${d}`;
}

export function relativeTime(iso: string | Date) {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Ayer";
  const diffDays = (now.getTime() - date.getTime()) / 86_400_000;
  if (diffDays < 6) return date.toLocaleDateString("es-ES", { weekday: "short" });
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

export function initials(name: string) {
  const clean = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim();
  if (!clean || /^\d/.test(clean)) return "#";
  const parts = clean.split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

const AVATAR_TONES = [
  "bg-sky-100 text-sky-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-800",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
];

export function Avatar({ name, seed, size = "md" }: { name: string; seed: string; size?: "sm" | "md" }) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      className={clsx(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        AVATAR_TONES[hash % AVATAR_TONES.length],
        size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm"
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function RiskBadge({ level, score }: { level: "bajo" | "medio" | "alto"; score: number }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        level === "bajo" && "bg-emerald-50 text-emerald-700",
        level === "medio" && "bg-amber-50 text-amber-800",
        level === "alto" && "bg-red-50 text-red-700"
      )}
      title={`Riesgo de baneo ${score}/100`}
    >
      Riesgo {level}
    </span>
  );
}

export async function jsonFetch<T = any>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

export function randomKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Nombre visible: si el "nombre" es solo un teléfono (o un chatId), se formatea.
export function displayName(name: string | null | undefined, phone: string | null | undefined) {
  const n = (name ?? "").trim();
  if (n && !n.includes("@") && !/^\+?[\d\s]{6,}$/.test(n)) return n;
  return formatPhone(phone || n) || "Sin nombre";
}
