"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import {
  Loader2,
  Plus,
  Star,
  MessageSquare,
  Pause,
  Play,
  Trash2,
  Sparkles,
  Send,
  X,
  MapPin
} from "lucide-react";

type Ficha = {
  id: string;
  name: string;
  category: string;
  tone?: string;
  accountId?: string;
  locationId?: string;
  emails?: string;
  rating: number;
  reviewCount: number;
  unreplied: number;
  status: string;
};

type Review = {
  id: string;
  reviewId: string;
  authorName: string;
  authorPhoto: string;
  rating: number;
  comment: string | null;
  reviewReply: string | null;
  reviewTime: string | null;
};

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={"h-3.5 w-3.5 " + (i <= Math.round(n) ? "text-amber-400 fill-amber-400" : "text-slate-300")}
        />
      ))}
    </span>
  );
}

export default function GmbHubClient() {
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/v1/gmb/clients");
    if (r.ok) {
      const d = await r.json();
      setFichas(d.clients ?? []);
    }
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  const totalUnreplied = fichas.reduce((s, f) => s + (f.unreplied ?? 0), 0);

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="GMB Hub"
        description="Gestiona las fichas de Google My Business y responde reseñas. Las reseñas entran vía Make."
        actions={
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Nueva ficha
          </button>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Kpi label="Fichas" value={fichas.length} />
        <Kpi label="Activas" value={fichas.filter((f) => f.status === "active").length} />
        <Kpi label="Reseñas" value={fichas.reduce((s, f) => s + (f.reviewCount ?? 0), 0)} />
        <Kpi label="Sin responder" value={totalUnreplied} tone={totalUnreplied > 0 ? "amber" : "default"} />
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : fichas.length === 0 ? (
        <div className="bg-white rounded-xl border p-10 text-center text-sm text-slate-500">
          No hay fichas todavía.{" "}
          <button onClick={() => setShowNew(true)} className="text-brand-600 underline">
            Crea la primera
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {fichas.map((f) => (
            <button
              key={f.id}
              onClick={() => setOpenId(f.id)}
              className="text-left bg-white rounded-xl border p-4 hover:border-brand-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{f.name}</div>
                  {f.category && <div className="text-[11px] text-slate-500">{f.category}</div>}
                </div>
                <span
                  className={
                    "text-[10px] px-2 py-0.5 rounded-full " +
                    (f.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600")
                  }
                >
                  {f.status === "active" ? "Activa" : "Pausada"}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-2 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1">
                  <Stars n={f.rating} /> {f.rating?.toFixed(1)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MessageSquare className="h-3.5 w-3.5" /> {f.reviewCount}
                </span>
                {f.unreplied > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                    {f.unreplied} sin responder
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {openId && <FichaDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
      {showNew && (
        <NuevaFicha
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "amber" | "default" }) {
  return (
    <div className="bg-white rounded-xl border p-3">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={"text-xl font-bold " + (tone === "amber" ? "text-amber-600" : "text-slate-900")}>{value}</div>
    </div>
  );
}

function FichaDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ client: any; reviews: Review[]; averageRating: number; totalReviewCount: number } | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [onlyUnreplied, setOnlyUnreplied] = useState(false);

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/v1/gmb/clients/${id}/reviews${onlyUnreplied ? "?unreplied=1" : ""}`);
    if (r.ok) setData(await r.json());
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, onlyUnreplied]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-slate-50 rounded-2xl border w-full max-w-2xl my-8 shadow-xl">
        <div className="flex items-center justify-between p-4 border-b bg-white rounded-t-2xl sticky top-0">
          <div className="font-semibold text-sm">{data?.client?.name ?? "Ficha"}</div>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setOnlyUnreplied(false)}
              className={"px-2.5 py-1 rounded-lg border " + (!onlyUnreplied ? "bg-brand-50 border-brand-300 text-brand-700" : "bg-white")}
            >
              Todas
            </button>
            <button
              onClick={() => setOnlyUnreplied(true)}
              className={"px-2.5 py-1 rounded-lg border " + (onlyUnreplied ? "bg-brand-50 border-brand-300 text-brand-700" : "bg-white")}
            >
              Sin responder
            </button>
            {data && (
              <span className="ml-auto text-slate-500 inline-flex items-center gap-1">
                <Stars n={data.averageRating} /> {data.averageRating?.toFixed(1)} · {data.totalReviewCount} reseñas
              </span>
            )}
          </div>

          {loading ? (
            <div className="text-sm text-slate-500 flex items-center gap-2 p-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando reseñas…
            </div>
          ) : !data || data.reviews.length === 0 ? (
            <div className="text-sm text-slate-500 text-center p-8 bg-white rounded-xl border">
              No hay reseñas {onlyUnreplied ? "sin responder" : ""}. Llegan automáticamente vía Make.
            </div>
          ) : (
            data.reviews.map((rev) => (
              <ReviewCard key={rev.id} clientId={id} review={rev} onReplied={() => { load(); onChanged(); }} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewCard({ clientId, review, onReplied }: { clientId: string; review: Review; onReplied: () => void }) {
  const [reply, setReply] = useState(review.reviewReply ?? "");
  const [editing, setEditing] = useState(!review.reviewReply);
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function suggest() {
    setSuggesting(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/gmb/ai-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, reviewId: review.reviewId })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Error");
      setReply(d.reply ?? "");
      setEditing(true);
    } catch (e: any) {
      setMsg(e?.message ?? "Error generando respuesta");
    } finally {
      setSuggesting(false);
    }
  }

  async function publish() {
    if (!reply.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${clientId}/reviews/${encodeURIComponent(review.reviewId)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Error");
      setEditing(false);
      setMsg(d.sentToGoogle ? "✓ Publicada en Google" : "Guardada (configura el webhook de Make para publicar en Google)");
      onReplied();
    } catch (e: any) {
      setMsg(e?.message ?? "Error al publicar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-sm">{review.authorName || "Anónimo"}</div>
        <Stars n={review.rating} />
      </div>
      {review.comment && <p className="text-[13px] text-slate-700 mt-1 whitespace-pre-wrap">{review.comment}</p>}

      {review.reviewReply && !editing ? (
        <div className="mt-2 pl-3 border-l-2 border-emerald-300 bg-emerald-50/50 rounded-r p-2">
          <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold mb-0.5">Tu respuesta</div>
          <p className="text-[13px] text-slate-700 whitespace-pre-wrap">{review.reviewReply}</p>
          <button onClick={() => setEditing(true)} className="text-[11px] text-brand-600 underline mt-1">
            Editar
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            placeholder="Escribe la respuesta…"
            className="w-full px-3 py-2 rounded-lg border text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={suggest}
              disabled={suggesting}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs hover:bg-slate-50 disabled:opacity-50"
            >
              {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Sugerir IA
            </button>
            <button
              onClick={publish}
              disabled={busy || !reply.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Publicar respuesta
            </button>
          </div>
        </div>
      )}
      {msg && <p className="text-[11px] text-slate-500 mt-1">{msg}</p>}
    </div>
  );
}

function NuevaFicha({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: "",
    category: "",
    tone: "profesional",
    accountId: "",
    locationId: "",
    emails: ""
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!form.name.trim()) {
      setErr("El nombre es obligatorio");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/v1/gmb/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.error?.message ?? "Error");
      }
      onCreated();
    } catch (e: any) {
      setErr(e?.message ?? "Error");
    } finally {
      setSaving(false);
    }
  }

  const field = (k: keyof typeof form, label: string, placeholder?: string) => (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      <input
        value={form[k]}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="font-semibold text-sm">Nueva ficha GMB</div>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {field("name", "Nombre del negocio *", "Ej: Clínica Aitziber")}
          {field("category", "Categoría", "Ej: Clínica dental")}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Tono de respuesta</label>
            <select
              value={form.tone}
              onChange={(e) => setForm({ ...form, tone: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border text-sm"
            >
              <option value="profesional">Profesional</option>
              <option value="cercano">Cercano</option>
              <option value="formal">Formal</option>
              <option value="entusiasta">Entusiasta</option>
            </select>
          </div>
          {field("accountId", "GMB Account ID", "accounts/XXXXX")}
          {field("locationId", "GMB Location ID", "accounts/XXXXX/locations/YYYYY")}
          {field("emails", "Emails de aviso", "info@negociovivo.com")}
          <p className="text-[11px] text-slate-400 inline-flex items-start gap-1">
            <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
            Las reseñas se sincronizan vía Make hacia el webhook de GMB del workspace.
          </p>
          {err && <p className="text-xs text-rose-600">{err}</p>}
          <button
            onClick={save}
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Crear ficha
          </button>
        </div>
      </div>
    </div>
  );
}
