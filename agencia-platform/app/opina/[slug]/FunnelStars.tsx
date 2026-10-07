"use client";

import { useEffect, useState } from "react";

type Props = { slug: string; name: string; address: string; headline: string; color: string; logoUrl: string };

const LABELS = ["", "Muy mala", "Mala", "Normal", "Buena", "¡Excelente!"];

export default function FunnelStars({ slug, name, address, headline, color, logoUrl }: Props) {
  const [hover, setHover] = useState(0);
  const [stars, setStars] = useState(0);
  const [step, setStep] = useState<"rate" | "google" | "form" | "sent">("rate");
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const goUrl = (s: number) => `/api/v1/gmb/public/funnel/${encodeURIComponent(slug)}/go?s=${s}`;

  function choose(n: number) {
    setStars(n);
    fetch(`/api/v1/gmb/public/funnel/${encodeURIComponent(slug)}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "star", stars: n }),
      keepalive: true
    }).catch(() => {});
    setStep(n >= 4 ? "google" : "form");
  }

  useEffect(() => {
    if (step !== "google") return;
    const t = setTimeout(() => window.location.assign(goUrl(stars)), 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (form.message.trim().length < 5) return setErr("Cuéntanos un poco qué ha pasado, por favor.");
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/gmb/public/funnel/${encodeURIComponent(slug)}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, stars })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d?.message || "No se pudo enviar. Inténtalo de nuevo.");
      setStep("sent");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const shown = hover || stars;
  const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: 10, padding: "11px 12px", fontSize: 15, fontFamily: "inherit", background: "#fff", color: "#0f172a" };

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", background: "#f1f5f9" }}>
      <div style={{ width: "100%", maxWidth: 440, background: "#fff", borderRadius: 20, boxShadow: "0 10px 40px rgba(15,23,42,.08)", overflow: "hidden" }}>
        <div style={{ height: 6, background: color }} />
        <div style={{ padding: "28px 24px 24px", textAlign: "center" }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" style={{ maxHeight: 64, maxWidth: 180, objectFit: "contain", margin: "0 auto 12px", display: "block" }} />
          ) : (
            <div style={{ width: 56, height: 56, borderRadius: 16, background: color, color: "#fff", display: "grid", placeItems: "center", fontSize: 24, fontWeight: 700, margin: "0 auto 12px" }}>
              {name.trim().charAt(0).toUpperCase()}
            </div>
          )}
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", margin: 0 }}>{name}</h1>
          {address && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{address}</div>}

          {step === "rate" && (
            <>
              <p style={{ fontSize: 16, color: "#334155", margin: "22px 0 14px", lineHeight: 1.45 }}>
                {headline || `¿Qué tal ha sido tu experiencia con ${name}?`}
              </p>
              <div role="radiogroup" aria-label="Valoración" style={{ display: "flex", justifyContent: "center", gap: 6 }} onMouseLeave={() => setHover(0)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={stars === n}
                    aria-label={`${n} estrella${n > 1 ? "s" : ""}`}
                    onMouseEnter={() => setHover(n)}
                    onFocus={() => setHover(n)}
                    onClick={() => choose(n)}
                    style={{ background: "none", border: 0, padding: 4, cursor: "pointer", lineHeight: 0 }}
                  >
                    <svg width="46" height="46" viewBox="0 0 24 24" aria-hidden>
                      <path
                        d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z"
                        fill={n <= shown ? "#FBBC04" : "#e2e8f0"}
                        stroke={n <= shown ? "#F29900" : "#cbd5e1"}
                        strokeWidth="1"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ))}
              </div>
              <div style={{ height: 20, marginTop: 6, fontSize: 13, color: "#64748b" }}>{LABELS[shown]}</div>
            </>
          )}

          {step === "google" && (
            <div style={{ marginTop: 22 }}>
              <div style={{ fontSize: 30, color: "#FBBC04" }}>{"★".repeat(stars)}</div>
              <p style={{ fontSize: 16, color: "#334155", margin: "10px 0 18px", lineHeight: 1.45 }}>
                ¡Muchas gracias! Te llevamos a Google para que publiques tu reseña. Nos ayuda muchísimo.
              </p>
              <a href={goUrl(stars)} style={{ display: "block", background: color, color: "#fff", padding: "13px 18px", borderRadius: 12, textDecoration: "none", fontWeight: 600, fontSize: 15 }}>
                Escribir mi reseña en Google
              </a>
            </div>
          )}

          {step === "form" && (
            <form onSubmit={submit} style={{ marginTop: 20, textAlign: "left" }}>
              <div style={{ textAlign: "center", fontSize: 26, color: "#FBBC04", marginBottom: 6 }}>
                {"★".repeat(stars)}
                <span style={{ color: "#e2e8f0" }}>{"★".repeat(5 - stars)}</span>
              </div>
              <p style={{ fontSize: 15, color: "#334155", margin: "0 0 14px", lineHeight: 1.45, textAlign: "center" }}>
                Sentimos que no haya sido perfecto. Cuéntanos qué ha pasado: tu mensaje llega directamente al responsable de {name} para solucionarlo.
              </p>
              <div style={{ display: "grid", gap: 10 }}>
                <textarea
                  required
                  rows={4}
                  placeholder="¿Qué ha pasado? ¿Qué podemos mejorar?"
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  style={{ ...input, resize: "vertical" }}
                />
                <input placeholder="Tu nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={input} />
                <input type="email" placeholder="Tu email (para responderte)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={input} />
                <input type="tel" placeholder="Teléfono (opcional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={input} />
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden
                  value={form.website}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                  style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }}
                />
              </div>
              {err && <div style={{ color: "#b91c1c", fontSize: 13, marginTop: 10 }}>{err}</div>}
              <button
                type="submit"
                disabled={busy}
                style={{ width: "100%", marginTop: 14, background: color, color: "#fff", border: 0, padding: "13px 18px", borderRadius: 12, fontWeight: 600, fontSize: 15, cursor: "pointer", opacity: busy ? 0.6 : 1 }}
              >
                {busy ? "Enviando…" : "Enviar al responsable"}
              </button>
              <div style={{ textAlign: "center", marginTop: 16, fontSize: 13 }}>
                <a href={goUrl(stars)} style={{ color: "#475569" }}>
                  Prefiero publicar mi reseña en Google →
                </a>
              </div>
              <button type="button" onClick={() => { setStep("rate"); setStars(0); }} style={{ display: "block", margin: "10px auto 0", background: "none", border: 0, color: "#94a3b8", fontSize: 12, cursor: "pointer" }}>
                Cambiar mi valoración
              </button>
            </form>
          )}

          {step === "sent" && (
            <div style={{ marginTop: 22 }}>
              <div style={{ fontSize: 34 }}>🙏</div>
              <p style={{ fontSize: 16, color: "#334155", margin: "10px 0 6px", lineHeight: 1.45 }}>
                Gracias por contárnoslo. El responsable ya tiene tu mensaje{form.email || form.phone ? " y se pondrá en contacto contigo" : ""}.
              </p>
              <a href={goUrl(stars)} style={{ display: "inline-block", marginTop: 14, color: "#475569", fontSize: 13 }}>
                También puedes dejar tu reseña en Google →
              </a>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
