"use client";

import { useEffect, useState, useCallback } from "react";

type Proof = {
  kind: "mesa" | "challenge";
  refId: string;
  type: "review" | "photo" | "follow" | "challenge";
  typeLabel: string;
  shotUrl: string | null;
  label: string;
  date: string;
};

/**
 * Capturas aceptadas de forma PROVISIONAL (la IA no pudo validarlas) que el
 * negocio debe revisar a mano: ve la imagen y Aprueba o Rechaza. Aprobar quita el
 * aviso; Rechazar deshace la acción (sale del descuento / re-bloquea el cupón).
 */
export default function BubuiPendingProofs({ businessId, token }: { businessId: string; token: string }) {
  const [items, setItems] = useState<Proof[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/bubui/business/${businessId}/pending-proofs`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return;
      const d = await r.json();
      setItems(d.items ?? []);
    } catch {
      // silencioso
    }
  }, [businessId, token]);

  useEffect(() => { load(); }, [load]);

  async function act(p: Proof, action: "approve" | "reject") {
    setBusy(p.refId + p.type);
    try {
      await fetch(`/api/bubui/business/${businessId}/pending-proofs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind: p.kind, refId: p.refId, type: p.type === "challenge" ? undefined : p.type, action })
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!items || items.length === 0) return null;

  return (
    <section className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 bubui-fade-up">
      <h3 className="font-bold text-sm">⚠️ Capturas por verificar ({items.length})</h3>
      <p className="text-xs text-black/55 mb-3">
        La IA no pudo validarlas automáticamente. Revísalas: <b>Aprobar</b> mantiene el descuento; <b>Rechazar</b> lo deshace.
      </p>
      <ul className="space-y-3">
        {items.map((p) => (
          <li key={p.kind + p.refId + p.type} className="flex items-center gap-3 bg-white rounded-xl p-2 border border-black/5">
            {p.shotUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <a href={p.shotUrl} target="_blank" rel="noreferrer">
                <img src={p.shotUrl} alt="captura" className="w-16 h-16 object-cover rounded-lg border border-black/10" />
              </a>
            ) : (
              <div className="w-16 h-16 rounded-lg bg-black/5 flex items-center justify-center text-black/30 text-xs">sin img</div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{p.typeLabel}</p>
              <p className="text-xs text-black/50">{p.label} · {new Date(p.date).toLocaleDateString("es-ES")}</p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button
                onClick={() => act(p, "approve")}
                disabled={busy === p.refId + p.type}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50"
              >
                Aprobar
              </button>
              <button
                onClick={() => act(p, "reject")}
                disabled={busy === p.refId + p.type}
                className="px-3 py-1.5 rounded-lg bg-rose-100 text-rose-700 text-xs font-bold disabled:opacity-50"
              >
                Rechazar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
