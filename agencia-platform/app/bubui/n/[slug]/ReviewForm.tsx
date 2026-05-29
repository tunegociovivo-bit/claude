"use client";

/**
 * Formulario de reseña en la página pública del negocio. Lee el cliente
 * Bubui de localStorage (`bubui.customer`) y consulta al API si puede
 * valorar (requiere compra confirmada). Si no hay cliente o no ha comprado,
 * muestra un CTA suave en su lugar.
 */

import { useEffect, useState } from "react";

export default function ReviewForm({ businessId }: { businessId: string }) {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [canReview, setCanReview] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  useEffect(() => {
    let id: string | null = null;
    try {
      const raw = localStorage.getItem("bubui.customer");
      if (raw) id = JSON.parse(raw)?.customerId ?? null;
    } catch {}
    setCustomerId(id);
    if (!id) {
      setLoading(false);
      return;
    }
    fetch(`/api/bubui/reviews?businessId=${businessId}&customerId=${id}`)
      .then((r) => r.json())
      .then((j) => {
        setCanReview(Boolean(j.canReview));
        if (j.mine) {
          setRating(j.mine.rating ?? 0);
          setComment(j.mine.comment ?? "");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [businessId]);

  async function submit() {
    if (rating < 1) {
      setStatus({ kind: "err", msg: "Elige una puntuación." });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const r = await fetch("/api/bubui/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, customerId, rating, comment })
      });
      const j = await r.json();
      if (!r.ok) {
        setStatus({ kind: "err", msg: j?.error?.message ?? "No se pudo guardar." });
        return;
      }
      setStatus({ kind: "ok", msg: "¡Gracias por tu valoración!" });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  // Sin cliente o sin compra confirmada → CTA suave.
  if (!customerId || !canReview) {
    return (
      <p className="text-xs text-black/45 mt-2">
        {customerId
          ? "Podrás valorar este negocio cuando hagas una compra con Bubui."
          : "Compra con la app Bubui en este negocio para poder valorarlo."}
      </p>
    );
  }

  return (
    <div className="bubui-card p-4 mt-3 space-y-2">
      <div className="text-sm font-semibold">Tu valoración</div>
      <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onMouseEnter={() => setHover(n)}
            onClick={() => setRating(n)}
            className="text-2xl leading-none"
            aria-label={`${n} estrellas`}
          >
            <span style={{ color: (hover || rating) >= n ? "#F59E0B" : "#D1D5DB" }}>★</span>
          </button>
        ))}
      </div>
      <textarea
        rows={3}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={600}
        placeholder="Cuenta tu experiencia (opcional)"
        className="bubui-input w-full text-sm"
      />
      {status && (
        <p className={"text-xs " + (status.kind === "ok" ? "text-emerald-700" : "text-rose-700")}>
          {status.msg}
        </p>
      )}
      <button onClick={submit} disabled={busy} className="bubui-btn w-full">
        {busy ? "Guardando…" : "Enviar valoración"}
      </button>
    </div>
  );
}
