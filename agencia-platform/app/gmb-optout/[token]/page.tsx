"use client";

/**
 * Página PÚBLICA de baja (opt-out) de la campaña de reseñas. Un clic añade a la suppression list.
 */
import { useState } from "react";

export default function OptOut({ params }: { params: { token: string } }) {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function optOut() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/v1/gmb/public/optout/${params.token}`, { method: "POST" });
      if (r.ok) setDone(true); else setErr("No se pudo procesar la baja. El enlace puede haber caducado.");
    } catch { setErr("Error de red."); } finally { setBusy(false); }
  }
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "system-ui, sans-serif", background: "#f8fafc" }}>
      <div style={{ maxWidth: 420, width: "100%", background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", padding: 28, textAlign: "center" }}>
        {done ? (
          <>
            <div style={{ fontSize: 36 }}>✅</div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: "10px 0" }}>Baja confirmada</h1>
            <p style={{ color: "#475569", fontSize: 14 }}>No volverás a recibir mensajes de esta campaña. Gracias.</p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: "6px 0 10px" }}>¿Dejar de recibir mensajes?</h1>
            <p style={{ color: "#475569", fontSize: 14, marginBottom: 18 }}>Si confirmas, te añadiremos a nuestra lista de exclusión y no te enviaremos más solicitudes de reseña.</p>
            {err && <p style={{ color: "#e11d48", fontSize: 12, marginBottom: 10 }}>{err}</p>}
            <button onClick={optOut} disabled={busy} style={{ background: "#0f172a", color: "#fff", padding: "12px 20px", borderRadius: 10, border: "none", fontWeight: 600, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>{busy ? "Procesando…" : "Confirmar baja"}</button>
          </>
        )}
      </div>
    </main>
  );
}
