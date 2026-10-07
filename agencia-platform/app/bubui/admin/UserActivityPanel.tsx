"use client";

/**
 * Historial de actividad de un usuario de Bubui (panel admin).
 * Se abre como panel lateral desde la tabla de Usuarios.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Kind = "account" | "scan" | "purchase" | "coupon" | "share" | "friends" | "review" | "table" | "booking" | "push";
type Tone = "ok" | "pending" | "bad" | "neutral";

type Item = {
  id: string;
  at: string;
  kind: Kind;
  type: string;
  title: string;
  detail: string | null;
  businessName: string | null;
  amount: number | null;
  status: string | null;
  tone: Tone;
};

type Summary = {
  scans: number;
  pendingPurchases: number;
  purchases: number;
  spent: number;
  saved: number;
  couponsRedeemed: number;
  shares: number;
  linkOpens: number;
  friends: number;
  reviews: number;
};

type CustomerInfo = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  phoneVerified: boolean;
  postalCode: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  appVersion: string | null;
  appBuild: string | null;
  appPlatform: string | null;
  plusActive: boolean;
  ambassadorLevel: string;
  referralCode: string | null;
  referralWalletPct: number;
  referredBy: { id: string; name: string | null } | null;
  firstBusiness: { id: string; name: string } | null;
};

const KINDS: Array<{ k: Kind; label: string; icon: string }> = [
  { k: "scan", label: "Escaneos", icon: "📷" },
  { k: "purchase", label: "Compras", icon: "🛍️" },
  { k: "coupon", label: "Cupones y retos", icon: "🎟️" },
  { k: "share", label: "Compartido", icon: "📲" },
  { k: "friends", label: "Amigos", icon: "👥" },
  { k: "review", label: "Reseñas", icon: "⭐" },
  { k: "table", label: "Mesas", icon: "🍽️" },
  { k: "booking", label: "Citas", icon: "📅" },
  { k: "account", label: "Cuenta", icon: "👤" },
  { k: "push", label: "Notificaciones", icon: "🔔" }
];
const ICON = Object.fromEntries(KINDS.map((x) => [x.k, x.icon])) as Record<Kind, string>;
// Por defecto, todo lo que HACE el usuario; las notificaciones (lo que recibe)
// se activan aparte porque llenan el historial.
const DEFAULT_KINDS: Kind[] = KINDS.map((x) => x.k).filter((k) => k !== "push");

const TONE_STYLE: Record<Tone, { background: string; color: string }> = {
  ok: { background: "#dcfce7", color: "#166534" },
  pending: { background: "#fef3c7", color: "#92400e" },
  bad: { background: "#ffe4e6", color: "#9f1239" },
  neutral: { background: "#f1f5f9", color: "#334155" }
};

const TZ = "Europe/Madrid";
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });

function dayLabel(iso: string): string {
  const k = dayKey(iso);
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  if (k === today) return "Hoy";
  if (k === yesterday) return "Ayer";
  return new Date(iso).toLocaleDateString("es-ES", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const eur = (n: number) => `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

async function fetchJson(path: string) {
  const r = await fetch(path);
  if (r.status === 401) {
    window.location.href = "/login?callbackUrl=/bubui/admin";
    throw new Error("Sesión caducada — vuelve a iniciar sesión.");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
  return j;
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function UserActivityPanel({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const [kinds, setKinds] = useState<Kind[]>(DEFAULT_KINDS);
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState("");

  const url = useCallback(
    (before?: string | null) => {
      const u = new URL(`/api/bubui/admin/customers/${encodeURIComponent(customerId)}/activity`, window.location.origin);
      u.searchParams.set("limit", "60");
      u.searchParams.set("kinds", kinds.join(","));
      if (before) u.searchParams.set("before", before);
      return u.toString();
    },
    [customerId, kinds]
  );

  useEffect(() => {
    let alive = true;
    setItems(null);
    setErr("");
    fetchJson(url())
      .then((d) => {
        if (!alive) return;
        setCustomer(d.customer);
        setSummary(d.summary);
        setItems(d.items);
        setNextBefore(d.nextBefore);
      })
      .catch((e) => alive && setErr(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  async function loadMore() {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const d = await fetchJson(url(nextBefore));
      setItems((prev) => {
        const seen = new Set((prev ?? []).map((i) => i.id));
        return [...(prev ?? []), ...d.items.filter((i: Item) => !seen.has(i.id))];
      });
      setNextBefore(d.nextBefore);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleKind(k: Kind) {
    setKinds((prev) => {
      const next = prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k];
      return next.length ? next : prev;
    });
  }

  function exportCsv() {
    if (!items?.length) return;
    const header = ["Fecha", "Hora", "Tipo", "Acción", "Detalle", "Comercio", "Importe", "Estado"];
    const rows = items.map((i) => [
      new Date(i.at).toLocaleDateString("es-ES", { timeZone: TZ }),
      time(i.at),
      KINDS.find((x) => x.k === i.kind)?.label ?? i.kind,
      i.title,
      i.detail ?? "",
      i.businessName ?? "",
      i.amount != null ? i.amount.toFixed(2).replace(".", ",") : "",
      i.status ?? ""
    ]);
    const csv = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `bubui-historial-${(customer?.name ?? customerId).replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Agrupa por día manteniendo el orden (más reciente primero).
  const groups: Array<{ label: string; items: Item[] }> = [];
  for (const it of items ?? []) {
    const label = dayLabel(it.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(it);
    else groups.push({ label, items: [it] });
  }

  const allSelected = kinds.length === KINDS.length;

  // Portal a <body>: la tarjeta de Usuarios aplica `transform` al pasar el
  // ratón, y eso rompería el `position: fixed` del panel si colgara de ella.
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Historial del usuario">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl overflow-y-auto">
        <header className="sticky top-0 bg-white/95 backdrop-blur border-b border-black/5 px-5 py-4 z-10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wider text-black/45">Historial del usuario</div>
              <h2 className="text-lg font-black truncate">{customer?.name || customer?.email || "Cargando…"}</h2>
              {customer && (
                <p className="text-[12px] text-black/55">
                  {[customer.phone, customer.email].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={exportCsv} disabled={!items?.length} className="bubui-chip disabled:opacity-40" style={{ cursor: items?.length ? "pointer" : "default" }}>
                Exportar CSV
              </button>
              <button onClick={onClose} className="text-xl leading-none text-black/45 hover:text-black px-2" aria-label="Cerrar">
                ×
              </button>
            </div>
          </div>
        </header>

        <div className="px-5 py-4 space-y-4">
          {customer && (
            <section className="flex flex-wrap gap-1.5 text-[12px]">
              <Tag>Alta {new Date(customer.createdAt).toLocaleDateString("es-ES", { timeZone: TZ })}</Tag>
              {customer.lastSeenAt && <Tag>Última conexión {new Date(customer.lastSeenAt).toLocaleString("es-ES", { timeZone: TZ, dateStyle: "short", timeStyle: "short" })}</Tag>}
              {customer.appBuild && <Tag>App build {customer.appBuild}{customer.appPlatform ? ` · ${customer.appPlatform}` : ""}</Tag>}
              {customer.plusActive && <Tag style={{ background: "#FCE7F3", color: "#9D174D" }}>Plus</Tag>}
              {customer.ambassadorLevel !== "none" && <Tag>Embajador {customer.ambassadorLevel}</Tag>}
              {customer.referredBy && <Tag>Invitado por {customer.referredBy.name ?? "otro usuario"}</Tag>}
              {customer.firstBusiness && <Tag>Llegó por {customer.firstBusiness.name}</Tag>}
              {customer.referralWalletPct > 0 && <Tag>Hucha {customer.referralWalletPct}%</Tag>}
              {!customer.phoneVerified && <Tag style={TONE_STYLE.pending}>Teléfono sin verificar</Tag>}
            </section>
          )}

          {summary && (
            <section className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              <Stat label="Escaneos" value={summary.scans} sub={summary.pendingPurchases ? `${summary.pendingPurchases} pendiente${summary.pendingPurchases === 1 ? "" : "s"}` : undefined} />
              <Stat label="Compras" value={summary.purchases} sub={eur(summary.spent)} />
              <Stat label="Ahorrado" value={eur(summary.saved)} />
              <Stat label="Cupones canjeados" value={summary.couponsRedeemed} />
              <Stat label="Veces compartido" value={summary.shares} />
              <Stat label="Clics en su enlace" value={summary.linkOpens} />
              <Stat label="Amigos traídos" value={summary.friends} />
              <Stat label="Reseñas" value={summary.reviews} />
            </section>
          )}

          <section className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setKinds(allSelected ? DEFAULT_KINDS : KINDS.map((x) => x.k))}
              className="bubui-chip text-[12px]"
              style={{ cursor: "pointer" }}
            >
              {allSelected ? "Sin notificaciones" : "Ver todo"}
            </button>
            {KINDS.map(({ k, label, icon }) => {
              const on = kinds.includes(k);
              return (
                <button
                  key={k}
                  onClick={() => toggleKind(k)}
                  className="bubui-chip text-[12px]"
                  aria-pressed={on}
                  style={on ? { background: "#ec1c6e", color: "#fff", cursor: "pointer" } : { cursor: "pointer", opacity: 0.7 }}
                >
                  {icon} {label}
                </button>
              );
            })}
          </section>

          {err && <p className="text-rose-700 text-sm">{err}</p>}
          {!items && !err && (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => <div key={i} className="bubui-skeleton h-14" />)}
            </div>
          )}
          {items && items.length === 0 && <p className="text-sm text-black/50 py-6 text-center">Sin actividad para estos filtros.</p>}

          {groups.map((g) => (
            <section key={g.label}>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-black/45 mb-2 first-letter:uppercase">{g.label}</h3>
              <ol className="space-y-1.5">
                {g.items.map((it) => (
                  <li key={it.id} className="flex gap-3 rounded-xl border border-black/5 px-3 py-2.5">
                    <span className="text-lg leading-6 w-6 text-center shrink-0" aria-hidden>
                      {ICON[it.kind]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[13px] font-semibold leading-snug">{it.title}</p>
                        <span className="text-[11px] text-black/45 tabular-nums shrink-0 pt-0.5">{time(it.at)}</span>
                      </div>
                      {it.detail && <p className="text-[12px] text-black/60 leading-snug mt-0.5">{it.detail}</p>}
                      {it.status && (
                        <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[11px] font-medium" style={TONE_STYLE[it.tone]}>
                          {it.status}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}

          {nextBefore && (
            <button onClick={loadMore} disabled={loadingMore} className="bubui-btn w-full py-2 text-sm disabled:opacity-60">
              {loadingMore ? "Cargando…" : "Cargar actividad anterior"}
            </button>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}

function Tag({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span className="px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: "#f1f5f9", ...style }}>
      {children}
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-xl bg-black/[0.03] px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-black/45 leading-tight">{label}</div>
      <div className="text-base font-black tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-black/50 tabular-nums">{sub}</div>}
    </div>
  );
}
