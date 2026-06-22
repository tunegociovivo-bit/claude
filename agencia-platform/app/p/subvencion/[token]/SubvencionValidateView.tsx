"use client";

import { useState } from "react";
import type { SubvProposalMatch } from "@/lib/bubui/subvenciones";

export default function SubvencionValidateView({
  token,
  businessName,
  matches,
  accepted
}: {
  token: string;
  businessName: string;
  matches: SubvProposalMatch[];
  accepted: boolean;
}) {
  const [done, setDone] = useState(accepted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/public/bubui-subvencion/${token}`, { method: "POST" });
      if (!r.ok) {
        setError("No se ha podido registrar tu confirmación. Inténtalo de nuevo.");
        return;
      }
      setDone(true);
    } catch {
      setError("Sin conexión. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">💶</div>
          <h1 className="text-2xl font-black text-slate-900">Subvenciones para {businessName}</h1>
          <p className="text-slate-600 text-sm mt-1">
            Desde <strong>Bubui</strong> hemos encontrado estas ayudas que encajan con tu negocio.
          </p>
        </div>

        <div className="bg-white rounded-2xl border shadow-sm divide-y">
          {matches.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">No hay subvenciones en esta propuesta.</p>
          ) : (
            matches.map((m) => (
              <div key={m.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold text-slate-900 text-sm">{m.titulo}</h3>
                  {m.importeTotal ? (
                    <span className="shrink-0 text-emerald-700 font-bold text-sm">
                      hasta {Math.round(m.importeTotal).toLocaleString("es-ES")} €
                    </span>
                  ) : null}
                </div>
                {m.motivo && <p className="text-xs text-slate-600 mt-1">{m.motivo}</p>}
                <div className="text-[11px] text-slate-400 mt-1.5 flex gap-3">
                  {m.fechaFin && <span>Cierra: {new Date(m.fechaFin).toLocaleDateString("es-ES")}</span>}
                  {m.urlBases && (
                    <a href={m.urlBases} target="_blank" rel="noreferrer" className="text-pink-600 hover:underline">
                      Ver bases
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {done ? (
          <div className="mt-6 rounded-2xl bg-emerald-50 border border-emerald-200 p-5 text-center">
            <div className="text-3xl mb-1">✅</div>
            <p className="font-bold text-emerald-800">¡Recibido!</p>
            <p className="text-sm text-emerald-700 mt-1">
              Nos pondremos en contacto contigo en breve para gestionarte estas subvenciones. No tienes que hacer nada más.
            </p>
          </div>
        ) : (
          <div className="mt-6 text-center">
            <p className="text-sm text-slate-600 mb-3">
              ¿Quieres que <strong>nos encarguemos del papeleo por ti</strong>? Confírmalo con un clic:
            </p>
            <button
              onClick={accept}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-pink-600 hover:bg-pink-700 disabled:opacity-50 text-white font-black px-6 py-3.5 text-sm shadow-lg"
            >
              {busy ? "Enviando…" : "Sí, quiero que me lo gestionéis"}
            </button>
            {error && <p className="text-rose-600 text-xs mt-2">{error}</p>}
          </div>
        )}

        <p className="text-center text-[11px] text-slate-400 mt-6">Bubui · Negocio Vivo</p>
      </div>
    </main>
  );
}
