"use client";

import { useState } from "react";

/** Formulario de la URL "A": el usuario escribe su opinión y pulsa "Opinar". */
export default function OpinarForm({ slug }: { slug: string }) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (body.trim().length < 2) {
      setError("Escribe tu opinión.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/public/review-opinion/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || null, body: body.trim() })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j?.error?.message ?? "No se pudo enviar. Inténtalo de nuevo.");
        return;
      }
      setDone(true);
    } catch {
      setError("No se pudo enviar. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="text-center py-6">
        <div className="text-4xl mb-2">🙌</div>
        <p className="text-slate-800 font-semibold">¡Gracias por tu opinión!</p>
        <p className="text-slate-500 text-sm mt-1">La hemos recibido correctamente.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Tu nombre (opcional)"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Escribe aquí tu opinión…"
        rows={5}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
      />
      {error && <p className="text-rose-600 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 text-sm"
      >
        {busy ? "Enviando…" : "Opinar"}
      </button>
    </form>
  );
}
