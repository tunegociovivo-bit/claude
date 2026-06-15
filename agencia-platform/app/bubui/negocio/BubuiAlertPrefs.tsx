"use client";

import { useState } from "react";

type Prefs = { pushOnNewClient: boolean; pushOnReview: boolean; pushOnBooking: boolean; pushOnCoupon: boolean };

const ITEMS: { key: keyof Prefs; label: string }[] = [
  { key: "pushOnNewClient", label: "Clientes nuevos" },
  { key: "pushOnReview", label: "Reseñas" },
  { key: "pushOnBooking", label: "Citas" },
  { key: "pushOnCoupon", label: "Cupones canjeados" }
];

/**
 * Interruptores de qué avisos push quiere recibir el dueño en su dispositivo.
 * Guarda cada cambio en el perfil del negocio (PATCH). El feed "Novedades" del
 * panel sigue registrando todo; esto solo controla la notificación push.
 */
export default function BubuiAlertPrefs({
  businessId,
  token,
  initial
}: {
  businessId: string;
  token: string;
  initial: Partial<Prefs>;
}) {
  const [prefs, setPrefs] = useState<Prefs>({
    pushOnNewClient: initial.pushOnNewClient !== false,
    pushOnReview: initial.pushOnReview !== false,
    pushOnBooking: initial.pushOnBooking !== false,
    pushOnCoupon: initial.pushOnCoupon !== false
  });
  const [saving, setSaving] = useState<string | null>(null);

  async function toggle(key: keyof Prefs) {
    const next = !prefs[key];
    setPrefs((p) => ({ ...p, [key]: next })); // optimista
    setSaving(key);
    try {
      await fetch(`/api/bubui/business/${businessId}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [key]: next })
      });
    } catch {
      setPrefs((p) => ({ ...p, [key]: !next })); // revierte si falla
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
      {ITEMS.map((it) => {
        const on = prefs[it.key];
        return (
          <button
            key={it.key}
            onClick={() => toggle(it.key)}
            disabled={saving === it.key}
            className={`text-[11px] font-semibold rounded-full px-2.5 py-1 border transition ${
              on ? "bg-pink-100 border-pink-300 text-pink-800" : "bg-black/5 border-black/10 text-black/40"
            } disabled:opacity-60`}
          >
            {on ? "✓ " : ""}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
