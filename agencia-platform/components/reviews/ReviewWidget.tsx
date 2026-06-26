"use client";

import { useEffect, useState } from "react";

export default function ReviewWidget({ slug, clientName }: { slug: string; clientName: string }) {
  const [body, setBody] = useState<string>("");
  const [destinationUrl, setDestinationUrl] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const r = await fetch("/api/v1/reviews/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug })
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data?.error?.message ?? "No se pudo generar la reseña ahora.");
        setLoading(false);
        return;
      }
      setBody(data.body);
      setDestinationUrl(data.destinationUrl);
    } catch (e: any) {
      setError(e.message ?? "Error desconocido");
    }
    setLoading(false);
  }

  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function copyAndGo() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => {
        window.location.href = destinationUrl;
      }, 500);
    } catch {
      // Si clipboard falla, abrimos el destino directamente
      window.location.href = destinationUrl;
    }
  }

  return (
    <div
      style={{
        border: "2px dashed #5B6CFF",
        padding: "24px",
        borderRadius: "12px",
        background: "#fff",
        textAlign: "center",
        maxWidth: "500px",
        margin: "10px auto",
        boxSizing: "border-box"
      }}
    >
      <div style={{ marginBottom: "12px" }}>
        <div style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700, marginBottom: "6px" }}>
          Sigue los pasos:
        </div>
        <ol style={{ margin: 0, padding: 0, listStyle: "none", textAlign: "left", display: "inline-block", color: "#334155", fontSize: "13px", lineHeight: 1.6 }}>
          <li>1- Dale al botón de “Copiar y opinar”</li>
          <li>2- Marca 5 estrellas y pega la reseña</li>
          <li>3- Enviar</li>
        </ol>
      </div>

      {loading && !body ? (
        <p style={{ color: "#64748b", fontStyle: "italic", margin: "10px 0 18px" }}>Generando reseña…</p>
      ) : error ? (
        <p style={{ color: "#b91c1c", margin: "10px 0 18px" }}>{error}</p>
      ) : (
        <p
          style={{
            color: "#1e293b",
            margin: "10px 0 18px",
            fontSize: "15px",
            lineHeight: "1.55",
            fontStyle: "italic"
          }}
        >
          “{body}”
        </p>
      )}

      <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
        <button
          onClick={copyAndGo}
          disabled={loading || !body || !!error}
          style={{
            background: "#5B6CFF",
            color: "#fff",
            border: 0,
            padding: "10px 18px",
            borderRadius: "8px",
            fontWeight: 600,
            fontSize: "13px",
            cursor: loading || !body || error ? "not-allowed" : "pointer",
            opacity: loading || !body || error ? 0.5 : 1
          }}
        >
          {copied ? "✓ Copiado, abriendo…" : "Copiar y opinar"}
        </button>
        <button
          onClick={generate}
          disabled={loading}
          style={{
            background: "#fff",
            color: "#475569",
            border: "1px solid #e2e8f0",
            padding: "10px 14px",
            borderRadius: "8px",
            fontWeight: 500,
            fontSize: "13px",
            cursor: loading ? "not-allowed" : "pointer"
          }}
        >
          {loading ? "…" : "Generar otra"}
        </button>
      </div>
    </div>
  );
}
