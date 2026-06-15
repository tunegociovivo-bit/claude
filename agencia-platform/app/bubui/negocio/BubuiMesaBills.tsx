"use client";

import { useEffect, useState } from "react";

type Bill = {
  id: string;
  tableLabel: string | null;
  diners: number;
  ticket: number;
  pct: number;
  saved: number;
  payNow: number;
  date: string;
};

/**
 * Cuentas de Mesa Colectiva que Bubui ha traído al negocio: importe, % aplicado,
 * comensales y fecha. De un vistazo, el valor que aporta la app.
 */
export default function BubuiMesaBills({ businessId, token }: { businessId: string; token: string }) {
  const [items, setItems] = useState<Bill[] | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/bubui/business/${businessId}/table-bills`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!r.ok) return;
        const d = await r.json();
        setItems(d.items ?? []);
        setTotal(d.totalTicket ?? 0);
      } catch {
        // silencioso
      }
    })();
  }, [businessId, token]);

  if (!items || items.length === 0) return null;

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-4 bubui-fade-up">
      <h3 className="font-bold text-sm">🧾 Cuentas de Mesa Colectiva</h3>
      <p className="text-xs text-black/55 mb-2">
        Lo que Bubui te ha traído en mesas · {items.length} cuenta{items.length === 1 ? "" : "s"} ·{" "}
        <b>{total.toFixed(2)} €</b> facturados
      </p>
      <ul className="divide-y divide-black/5">
        {items.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
            <span className="text-black/60">
              {new Date(b.date).toLocaleDateString("es-ES")}
              {b.tableLabel ? ` · ${b.tableLabel}` : ""} · {b.diners} 👤
            </span>
            <span className="font-semibold text-black/80 text-right">
              {b.ticket.toFixed(2)} € · <span className="text-pink-700">-{b.pct}%</span> · pagó {b.payNow.toFixed(2)} €
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
