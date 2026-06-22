"use client";

/**
 * Revisión de propuestas de subvenciones para comercios de Bubui.
 * El Cazador encuentra ayudas del nicho de cada comercio y crea propuestas
 * PENDIENTES aquí. El admin las aprueba (se envían al comercio por
 * WhatsApp+email con enlace de validación) o las descarta.
 */
import { useEffect, useState } from "react";

type Match = {
  id: string;
  titulo: string;
  motivo?: string;
  probabilidad?: number | null;
  importeTotal?: number | null;
  fechaFin?: string | null;
  urlBases?: string | null;
};
type Proposal = {
  id: string;
  status: "pending" | "sent" | "accepted" | "rejected";
  createdAt: string;
  sentWhatsapp: boolean;
  sentEmail: boolean;
  matches: Match[];
  business: { id: string; name: string; category: string | null; city: string | null; email: string | null; phone: string | null; slug: string };
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  sent: "Enviada",
  accepted: "Aceptada ✅",
  rejected: "Descartada"
};
const STATUS_CLASS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-300",
  sent: "bg-sky-100 text-sky-800 border-sky-300",
  accepted: "bg-emerald-100 text-emerald-800 border-emerald-300",
  rejected: "bg-slate-100 text-slate-500 border-slate-200"
};

type Metrics = {
  total: number;
  validationRate: number;
  eurosEnJuego: number;
  bySector: { name: string; count: number }[];
  byZona: { name: string; count: number }[];
};

function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

export default function BubuiSubvencionesReview() {
  const [items, setItems] = useState<Proposal[]>([]);
  const [counts, setCounts] = useState<{ pending: number; sent: number; accepted: number } | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Borrador IA por (propuesta+convocatoria).
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState<string | null>(null);
  const [draftText, setDraftText] = useState<string>("");

  async function genBorrador(businessId: string, convocatoriaId: string) {
    const key = `${businessId}:${convocatoriaId}`;
    if (draftKey === key) { setDraftKey(null); return; } // toggle cerrar
    setDraftBusy(key);
    setDraftText("");
    try {
      const r = await fetch("/api/v1/admin/bubui/subvenciones/borrador", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, convocatoriaId })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(d?.error?.message ?? "No se pudo generar el borrador");
        return;
      }
      setDraftText(d.borrador ?? "");
      setDraftKey(key);
    } finally {
      setDraftBusy(null);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/v1/admin/bubui/subvenciones");
      if (r.ok) {
        const d = await r.json();
        setItems(d.items ?? []);
        setCounts(d.counts ?? null);
        setMetrics(d.metrics ?? null);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function act(id: string, action: "approve" | "reject") {
    if (action === "reject" && !confirm("¿Descartar esta propuesta? No se enviará al comercio.")) return;
    setBusyId(id);
    try {
      const r = await fetch(`/api/v1/admin/bubui/subvenciones/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(d?.error?.message ?? "No se pudo procesar");
      } else if (action === "approve") {
        const canales = [d.whatsapp ? "WhatsApp" : null, d.email ? "email" : null].filter(Boolean).join(" + ");
        alert(canales ? `Enviado al comercio por ${canales}.` : "Aprobada, pero no se pudo enviar (revisa teléfono/email del comercio).");
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="bg-white rounded-xl border p-5 mt-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold flex items-center gap-2">💶 Subvenciones a comercios de Bubui</h2>
        <button onClick={load} className="text-xs text-brand-600 hover:text-brand-700">Refrescar</button>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        El Cazador busca ayudas del nicho de cada comercio. Revisa y aprueba para enviárselas por WhatsApp + email con un enlace de validación.
      </p>

      {counts && (
        <div className="flex gap-2 mb-4 text-xs flex-wrap">
          <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-semibold">{counts.pending} pendientes</span>
          <span className="px-2.5 py-1 rounded-full bg-sky-100 text-sky-800 font-semibold">{counts.sent} enviadas</span>
          <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-semibold">{counts.accepted} aceptadas</span>
        </div>
      )}

      {/* Métricas (también sirven de argumento para el ayuntamiento). */}
      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <div className="rounded-lg border bg-slate-50 p-3">
            <div className="text-lg font-bold">{metrics.total}</div>
            <div className="text-[11px] text-slate-500">Propuestas totales</div>
          </div>
          <div className="rounded-lg border bg-slate-50 p-3">
            <div className="text-lg font-bold">{metrics.validationRate}%</div>
            <div className="text-[11px] text-slate-500">Validación (aceptan / enviadas)</div>
          </div>
          <div className="rounded-lg border bg-emerald-50 p-3">
            <div className="text-lg font-bold text-emerald-700">{metrics.eurosEnJuego.toLocaleString("es-ES")} €</div>
            <div className="text-[11px] text-slate-500">En juego (ayudas de comercios interesados)</div>
          </div>
          <div className="rounded-lg border bg-slate-50 p-3">
            <div className="text-[11px] text-slate-500 mb-0.5">Por sector</div>
            <div className="text-[11px] text-slate-700 leading-tight">
              {metrics.bySector.slice(0, 3).map((s) => `${s.name} (${s.count})`).join(", ") || "—"}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 py-4">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-400 py-4">Aún no hay propuestas. Se generan cuando entra un comercio nuevo o en el barrido semanal.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((p) => (
            <li key={p.id} className="border rounded-lg p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm truncate">{p.business.name}</span>
                    <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${STATUS_CLASS[p.status]}`}>
                      {STATUS_LABEL[p.status]}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {p.business.category ?? "—"} · {p.business.city ?? "—"}
                    {p.business.phone ? ` · ${p.business.phone}` : ""}
                    {p.business.email ? ` · ${p.business.email}` : ""}
                  </div>
                </div>
                {p.status === "pending" && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => act(p.id, "reject")}
                      disabled={busyId === p.id}
                      className="text-xs px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 disabled:opacity-50"
                    >
                      Descartar
                    </button>
                    <button
                      onClick={() => act(p.id, "approve")}
                      disabled={busyId === p.id}
                      className="text-xs px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50"
                    >
                      {busyId === p.id ? "Enviando…" : "Aprobar y enviar"}
                    </button>
                  </div>
                )}
              </div>

              <ul className="mt-3 space-y-1.5">
                {p.matches.map((m) => {
                  const d = daysUntil(m.fechaFin);
                  const urgent = d != null && d >= 0 && d <= 15;
                  const key = `${p.business.id}:${m.id}`;
                  const prob = typeof m.probabilidad === "number" ? m.probabilidad : null;
                  const probClass = prob == null ? "" : prob >= 66 ? "bg-emerald-100 text-emerald-800" : prob >= 40 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600";
                  return (
                    <li key={m.id} className="text-xs">
                      <div className="flex items-start gap-2">
                        <span className="text-slate-300 mt-0.5">•</span>
                        <span className="text-slate-700 flex-1">
                          <strong>{m.titulo}</strong>
                          {m.importeTotal ? <span className="text-emerald-700 font-semibold"> — hasta {Math.round(m.importeTotal).toLocaleString("es-ES")} €</span> : null}
                          {urgent ? (
                            <span className="text-rose-600 font-semibold"> ⏳ cierra en {d} día{d === 1 ? "" : "s"}</span>
                          ) : m.fechaFin ? (
                            <span className="text-slate-400"> (cierra {new Date(m.fechaFin).toLocaleDateString("es-ES")})</span>
                          ) : null}
                          {prob != null && (
                            <span className={`ml-1 px-1.5 py-0.5 rounded-full font-semibold ${probClass}`}>🎯 {prob}% concesión</span>
                          )}
                          {m.motivo ? <span className="block text-slate-500">{m.motivo}</span> : null}
                        </span>
                        <button
                          onClick={() => genBorrador(p.business.id, m.id)}
                          disabled={draftBusy === key}
                          className="shrink-0 text-[11px] px-2 py-1 rounded-md border bg-white hover:bg-slate-50 disabled:opacity-50"
                        >
                          {draftBusy === key ? "Generando…" : draftKey === key ? "Ocultar" : "Borrador"}
                        </button>
                      </div>
                      {draftKey === key && (
                        <div className="mt-1.5 ml-4 rounded-lg border bg-slate-50 p-2">
                          <pre className="whitespace-pre-wrap font-sans text-[11px] text-slate-700 max-h-72 overflow-auto">{draftText}</pre>
                          <button
                            onClick={() => navigator.clipboard?.writeText(draftText)}
                            className="mt-1 text-[11px] text-brand-600 hover:text-brand-700"
                          >
                            Copiar borrador
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {p.status !== "pending" && (
                <div className="text-[11px] text-slate-400 mt-2">
                  {p.status === "sent" && `Enviada${p.sentWhatsapp ? " · WhatsApp" : ""}${p.sentEmail ? " · email" : ""}`}
                  {p.status === "accepted" && "El comercio ha confirmado que quiere que se lo gestionéis."}
                  {p.status === "rejected" && "Descartada."}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
