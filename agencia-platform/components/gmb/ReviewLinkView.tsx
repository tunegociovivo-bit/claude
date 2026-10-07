"use client";

/**
 * GMB Hub → «Enlace de reseñas».
 * 1) Analiza un negocio y genera su enlace directo de reseña en Google (como Whitespark).
 * 2) Crea la página de valoración con 5 estrellas: 4-5 → Google; 1-3 → opinión privada al dueño,
 *    con el acceso a Google siempre visible (cumple la política de Google: sin review gating).
 */
import { useEffect, useState } from "react";
import {
  Search, Loader2, Copy, Check, ExternalLink, Star, QrCode, Trash2, MapPin, Mail, MessageSquareWarning, ChevronDown, ChevronUp, Download
} from "lucide-react";

type Place = {
  placeId: string; name: string; address: string; category: string; rating: number | null; ratingCount: number;
  phone: string; website: string; mapsUrl: string; reviewUrl: string; businessStatus: string | null;
};
type Funnel = {
  id: string; slug: string; businessName: string; address: string; placeId: string; reviewUrl: string; mapsUrl: string;
  rating: number | null; ratingCount: number; ownerEmail: string; headline: string; color: string; logoUrl: string; active: boolean;
  publicUrl: string; qrUrl: string; metrics?: { views: number; stars: number; google: number; complaints: number; pending: number };
};
type Feedback = { id: string; stars: number; name: string; email: string; phone: string; message: string; emailed: boolean; status: string; createdAt: string };

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  return {
    copied,
    copy: async (key: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        /* sin permiso de portapapeles */
      }
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    }
  };
}

function CopyRow({ label, value, id, copier }: { label: string; value: string; id: string; copier: ReturnType<typeof useCopy> }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-slate-500 mb-1">{label}</div>
      <div className="flex items-center gap-1.5">
        <input readOnly value={value} onFocus={(e) => e.target.select()} className="flex-1 min-w-0 border rounded-lg px-2.5 py-1.5 text-[12px] bg-slate-50 text-slate-700" />
        <button onClick={() => copier.copy(id, value)} className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[12px] hover:bg-slate-50" title="Copiar">
          {copier.copied === id ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <a href={value} target="_blank" rel="noreferrer" className="shrink-0 inline-flex items-center px-2.5 py-1.5 rounded-lg border text-[12px] hover:bg-slate-50" title="Abrir">
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

function Rating({ rating, count }: { rating: number | null; count: number }) {
  if (rating == null) return <span className="text-[11px] text-slate-400">Sin reseñas</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-slate-600">
      <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" /> {rating.toFixed(1)} <span className="text-slate-400">({count})</span>
    </span>
  );
}

export default function ReviewLinkView() {
  const copier = useCopy();
  const [query, setQuery] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [analyzeErr, setAnalyzeErr] = useState<string | null>(null);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [draft, setDraft] = useState({ ownerEmail: "", headline: "", color: "#F4600C", logoUrl: "" });
  const [saving, setSaving] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [funnels, setFunnels] = useState<Funnel[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function loadFunnels() {
    const r = await fetch("/api/v1/gmb/review-funnels", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    setFunnels(d.funnels ?? []);
  }
  useEffect(() => {
    loadFunnels();
  }, []);

  async function analyze(e?: React.FormEvent) {
    e?.preventDefault();
    if (query.trim().length < 2) return;
    setAnalyzing(true);
    setAnalyzeErr(null);
    setPlaces(null);
    setCreatingFor(null);
    try {
      const r = await fetch("/api/v1/gmb/review-link/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d?.error?.message || d.message || "No se pudo analizar el negocio.");
      setPlaces(d.places ?? []);
    } catch (err: any) {
      setAnalyzeErr(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function create(p: Place) {
    setSaving(true);
    setCreateErr(null);
    try {
      const r = await fetch("/api/v1/gmb/review-funnels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: p.placeId, ...draft })
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d?.error?.message || d.message || "No se pudo crear la página.");
      setCreatingFor(null);
      setPlaces(null);
      setQuery("");
      await loadFunnels();
      setOpen(d.funnel.id);
    } catch (err: any) {
      setCreateErr(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, data: Partial<Funnel>) {
    await fetch(`/api/v1/gmb/review-funnels/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    loadFunnels();
  }
  async function remove(f: Funnel) {
    if (!window.confirm(`¿Eliminar la página de valoración de «${f.businessName}»? El enlace dejará de funcionar.`)) return;
    await fetch(`/api/v1/gmb/review-funnels/${f.id}`, { method: "DELETE" });
    loadFunnels();
  }

  return (
    <div className="space-y-5">
      {/* ───── Generador ───── */}
      <div className="bg-white border rounded-xl p-5">
        <div className="font-semibold text-sm mb-1">Generador de enlace de reseñas</div>
        <p className="text-[13px] text-slate-500 mb-3">
          Escribe el nombre del negocio con la ciudad (o pega su enlace de Google Maps). Lo analizamos y generamos el enlace que abre directamente la ventana de «Escribir reseña» de su ficha.
        </p>
        <form onSubmit={analyze} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ej.: Clínica March Marbella"
              className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <button disabled={analyzing || query.trim().length < 2} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium">
            {analyzing && <Loader2 className="h-4 w-4 animate-spin" />} Analizar
          </button>
        </form>
        {analyzeErr && <div className="mt-3 text-[13px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">{analyzeErr}</div>}
        {places && places.length === 0 && <div className="mt-3 text-sm text-slate-500">No hemos encontrado ese negocio en Google. Prueba con el nombre exacto y la ciudad.</div>}

        {places && places.length > 0 && (
          <div className="mt-4 space-y-3">
            {places.map((p) => (
              <div key={p.placeId} className="border rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{p.name}</div>
                    <div className="flex items-center gap-1 text-[12px] text-slate-500 mt-0.5">
                      <MapPin className="h-3 w-3 shrink-0" /> <span className="truncate">{p.address}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <Rating rating={p.rating} count={p.ratingCount} />
                      {p.category && <span className="text-[11px] text-slate-400">{p.category}</span>}
                      {p.businessStatus && p.businessStatus !== "OPERATIONAL" && <span className="text-[11px] text-rose-600">Cerrado</span>}
                    </div>
                  </div>
                  <a href={p.mapsUrl} target="_blank" rel="noreferrer" className="text-[12px] text-brand-600 hover:underline shrink-0">Ver en Maps</a>
                </div>
                <div className="mt-3">
                  <CopyRow label="Enlace directo para dejar reseña en Google" value={p.reviewUrl} id={`p-${p.placeId}`} copier={copier} />
                </div>
                {creatingFor !== p.placeId ? (
                  <button
                    onClick={() => { setCreatingFor(p.placeId); setCreateErr(null); }}
                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-[13px] font-medium"
                  >
                    <Star className="h-4 w-4" /> Crear página de valoración con 5 estrellas
                  </button>
                ) : (
                  <div className="mt-3 rounded-lg border bg-slate-50 p-3 space-y-2.5">
                    <div>
                      <label className="block text-[12px] font-medium text-slate-600 mb-1">Email del dueño (recibe las opiniones de 1 a 3 estrellas)</label>
                      <input type="email" value={draft.ownerEmail} onChange={(e) => setDraft({ ...draft, ownerEmail: e.target.value })} placeholder="dueño@negocio.com" className="w-full border rounded-lg px-3 py-2 text-sm bg-white" />
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-slate-600 mb-1">Pregunta (opcional)</label>
                      <input value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} placeholder={`¿Qué tal ha sido tu experiencia con ${p.name}?`} className="w-full border rounded-lg px-3 py-2 text-sm bg-white" />
                    </div>
                    <div className="flex gap-3">
                      <div>
                        <label className="block text-[12px] font-medium text-slate-600 mb-1">Color</label>
                        <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} className="h-9 w-14 border rounded-lg bg-white" />
                      </div>
                      <div className="flex-1">
                        <label className="block text-[12px] font-medium text-slate-600 mb-1">URL del logo (opcional)</label>
                        <input value={draft.logoUrl} onChange={(e) => setDraft({ ...draft, logoUrl: e.target.value })} placeholder="https://…/logo.png" className="w-full border rounded-lg px-3 py-2 text-sm bg-white" />
                      </div>
                    </div>
                    {!draft.ownerEmail && <div className="text-[11px] text-amber-700">Sin email del dueño, las opiniones privadas solo se verán aquí en el Hub.</div>}
                    {createErr && <div className="text-[12px] text-rose-700">{createErr}</div>}
                    <div className="flex gap-2">
                      <button onClick={() => create(p)} disabled={saving} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-[13px] font-medium">
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />} Crear página
                      </button>
                      <button onClick={() => setCreatingFor(null)} className="px-3 py-2 rounded-lg border text-[13px] bg-white">Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ───── Páginas creadas ───── */}
      <div>
        <div className="font-semibold text-sm mb-2">Páginas de valoración</div>
        {!funnels ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
        ) : funnels.length === 0 ? (
          <div className="bg-white border rounded-xl p-5 text-sm text-slate-500">Aún no hay ninguna. Analiza un negocio arriba y crea su página.</div>
        ) : (
          <div className="space-y-3">
            {funnels.map((f) => (
              <FunnelCard key={f.id} f={f} expanded={open === f.id} onToggle={() => setOpen(open === f.id ? null : f.id)} copier={copier} onPatch={patch} onRemove={remove} />
            ))}
          </div>
        )}
        <p className="text-[11px] text-slate-400 mt-3">
          Cómo funciona: con 4 o 5 estrellas el cliente va directo a Google. Con 1 a 3 se le ofrece primero contar el problema en privado (llega al email del dueño), pero el enlace a Google sigue visible. Google prohíbe impedir u ocultar las reseñas negativas («review gating»), así que la ficha no corre riesgo.
        </p>
      </div>
    </div>
  );
}

function FunnelCard({
  f, expanded, onToggle, copier, onPatch, onRemove
}: {
  f: Funnel; expanded: boolean; onToggle: () => void; copier: ReturnType<typeof useCopy>;
  onPatch: (id: string, d: Partial<Funnel>) => void; onRemove: (f: Funnel) => void;
}) {
  const [fb, setFb] = useState<{ feedback: Feedback[]; stars: Record<number, number> } | null>(null);
  const [email, setEmail] = useState(f.ownerEmail);
  const m = f.metrics ?? { views: 0, stars: 0, google: 0, complaints: 0, pending: 0 };

  async function loadFb() {
    const r = await fetch(`/api/v1/gmb/review-funnels/${f.id}/feedback`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (d.ok) setFb({ feedback: d.feedback, stars: d.stars });
  }
  useEffect(() => {
    if (expanded && !fb) loadFb();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  async function setStatus(id: string, status: string) {
    await fetch(`/api/v1/gmb/review-funnels/${f.id}/feedback`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedbackId: id, status }) });
    loadFb();
  }

  const maxStar = fb ? Math.max(1, ...Object.values(fb.stars)) : 1;

  return (
    <div className="bg-white border rounded-xl">
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="h-9 w-9 rounded-lg shrink-0 flex items-center justify-center text-white font-semibold" style={{ background: f.color }}>
          {f.businessName.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium truncate">{f.businessName}</span>
          <span className="flex items-center gap-3 text-[11px] text-slate-500">
            <Rating rating={f.rating} count={f.ratingCount} />
            <span>{m.views} visitas</span>
            <span>{m.google} a Google</span>
            <span>{m.complaints} opiniones privadas</span>
            {!f.active && <span className="text-rose-600">Pausada</span>}
          </span>
        </span>
        {m.pending > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 shrink-0">{m.pending} sin atender</span>}
        {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>

      {expanded && (
        <div className="border-t px-4 py-4 space-y-4">
          <div className="grid sm:grid-cols-[1fr_auto] gap-4">
            <div className="space-y-3">
              <CopyRow label="Página de valoración (5 estrellas) — compártela con los clientes" value={f.publicUrl} id={`f-${f.id}`} copier={copier} />
              <CopyRow label="Enlace directo de reseña en Google" value={f.reviewUrl} id={`g-${f.id}`} copier={copier} />
              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1 flex items-center gap-1"><Mail className="h-3 w-3" /> Email del dueño</div>
                <div className="flex gap-1.5">
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dueño@negocio.com" className="flex-1 border rounded-lg px-2.5 py-1.5 text-[12px]" />
                  {email !== f.ownerEmail && (
                    <button onClick={() => onPatch(f.id, { ownerEmail: email })} className="px-2.5 py-1.5 rounded-lg bg-brand-600 text-white text-[12px]">Guardar</button>
                  )}
                </div>
              </div>
            </div>
            <div className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.qrUrl} alt="QR de la página de valoración" className="h-32 w-32 border rounded-lg mx-auto" />
              <a href={`${f.qrUrl}?download=1`} className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-brand-600 hover:underline">
                <Download className="h-3.5 w-3.5" /> Descargar QR
              </a>
              <div>
                <a href={`${f.qrUrl}?target=google&download=1`} className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:underline">
                  <QrCode className="h-3 w-3" /> QR directo a Google
                </a>
              </div>
            </div>
          </div>

          {fb && (
            <div className="grid sm:grid-cols-[180px_1fr] gap-4">
              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1.5">Valoraciones en la página</div>
                {[5, 4, 3, 2, 1].map((n) => (
                  <div key={n} className="flex items-center gap-2 text-[11px] text-slate-600 mb-1">
                    <span className="w-6">{n}★</span>
                    <span className="flex-1 h-2 rounded bg-slate-100 overflow-hidden">
                      <span className={"block h-full " + (n >= 4 ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${((fb.stars[n] ?? 0) / maxStar) * 100}%` }} />
                    </span>
                    <span className="w-6 text-right">{fb.stars[n] ?? 0}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1.5 flex items-center gap-1"><MessageSquareWarning className="h-3 w-3" /> Opiniones privadas</div>
                {fb.feedback.length === 0 ? (
                  <div className="text-[12px] text-slate-400">Ninguna todavía.</div>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {fb.feedback.map((x) => (
                      <div key={x.id} className="border rounded-lg p-2.5 text-[12px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-amber-500">{"★".repeat(x.stars)}<span className="text-slate-200">{"★".repeat(5 - x.stars)}</span></span>
                          <span className="text-slate-400">{new Date(x.createdAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}</span>
                        </div>
                        <div className="whitespace-pre-wrap text-slate-700 mt-1">{x.message}</div>
                        <div className="text-slate-500 mt-1">
                          {[x.name, x.email, x.phone].filter(Boolean).join(" · ") || "Anónimo"}
                          {x.emailed && <span className="ml-2 text-emerald-600">✓ enviado al dueño</span>}
                        </div>
                        <div className="flex gap-1.5 mt-1.5">
                          {(["new", "contacted", "resolved"] as const).map((s) => (
                            <button
                              key={s}
                              onClick={() => setStatus(x.id, s)}
                              className={"px-2 py-0.5 rounded-full border text-[11px] " + (x.status === s ? "bg-slate-800 text-white border-slate-800" : "hover:bg-slate-50")}
                            >
                              {s === "new" ? "Nueva" : s === "contacted" ? "Contactado" : "Resuelta"}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <button onClick={() => onPatch(f.id, { active: !f.active })} className="text-[12px] text-slate-600 hover:underline">
              {f.active ? "Pausar página" : "Reactivar página"}
            </button>
            <button onClick={() => onRemove(f)} className="inline-flex items-center gap-1 text-[12px] text-rose-600 hover:underline">
              <Trash2 className="h-3.5 w-3.5" /> Eliminar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
