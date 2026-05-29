"use client";

/**
 * Formulario de reseña en la página pública del negocio.
 *
 * - Lee bubui.customer de localStorage y consulta /api/bubui/reviews para
 *   saber si el cliente puede valorar (compra confirmada) y si ya lo hizo.
 * - Si el dueño configuró `reviewRewardPct > 0`, muestra el incentivo antes
 *   de enviar y el cupón ganado después (solo en la PRIMERA reseña — el
 *   backend lo controla con la clave única).
 * - Si configuró `googlePlaceId`, ofrece un CTA "Compártela también en
 *   Google" tras enviar: copia el comentario al portapapeles y abre el
 *   formulario de reseña de Google con su local pre-seleccionado.
 */

import { useEffect, useState } from "react";

type Props = {
  businessId: string;
  reviewRewardPct?: number;
  googlePlaceId?: string | null;
  businessName?: string;
};

export default function ReviewForm({ businessId, reviewRewardPct = 0, googlePlaceId, businessName }: Props) {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [canReview, setCanReview] = useState(false);
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [reward, setReward] = useState<{ discountPct: number; expiresAt: string } | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);

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
          setAlreadyReviewed(true);
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
      setJustSubmitted(true);
      if (j.reward) setReward(j.reward);
      setAlreadyReviewed(true);
    } finally {
      setBusy(false);
    }
  }

  async function shareOnGoogle() {
    if (!googlePlaceId) return;
    // Pre-copia el comentario para que el cliente solo tenga que pegar.
    if (comment.trim()) {
      try { await navigator.clipboard.writeText(comment.trim()); } catch {}
    }
    const url = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(googlePlaceId)}`;
    window.open(url, "_blank", "noopener");
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

  const incentive =
    !alreadyReviewed && reviewRewardPct > 0
      ? `🎁 ${reviewRewardPct}% extra de descuento al dejar tu reseña`
      : null;

  return (
    <div className="bubui-card p-4 mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{alreadyReviewed ? "Tu valoración" : "Deja tu valoración"}</div>
        {incentive && (
          <span className="text-[11px] font-bold text-pink-700 bg-pink-100 px-2 py-0.5 rounded-full whitespace-nowrap">
            {incentive}
          </span>
        )}
      </div>
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
      {reward && (
        <div className="rounded-lg border border-pink-200 bg-pink-50 p-3 text-xs text-pink-900">
          <b>🎉 ¡Cupón desbloqueado!</b> Ya tienes un{" "}
          <b>{reward.discountPct}% extra</b>{businessName ? ` en ${businessName}` : ""}.
          Caduca el {new Date(reward.expiresAt).toLocaleDateString("es-ES", { day: "numeric", month: "long" })}.
        </div>
      )}
      <button onClick={submit} disabled={busy} className="bubui-btn w-full">
        {busy ? "Guardando…" : alreadyReviewed ? "Actualizar valoración" : "Enviar valoración"}
      </button>
      {/* Cross-post a Google: aparece tras enviar (o si ya había reseñado) */}
      {googlePlaceId && (justSubmitted || alreadyReviewed) && (
        <button
          onClick={shareOnGoogle}
          className="w-full text-xs font-semibold text-slate-700 border border-slate-300 rounded-full py-2 hover:bg-slate-50 inline-flex items-center justify-center gap-1.5"
        >
          <span aria-hidden>🌐</span> Compártela también en Google
        </button>
      )}
    </div>
  );
}
