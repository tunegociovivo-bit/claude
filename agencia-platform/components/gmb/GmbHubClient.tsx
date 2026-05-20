"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import {
  Loader2,
  Plus,
  Star,
  MessageSquare,
  Sparkles,
  Send,
  X,
  MapPin,
  Settings,
  Copy,
  Check,
  Gauge,
  Users
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
  const [showSettings, setShowSettings] = useState(false);

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
          <>
            <button
              onClick={() => setShowSettings(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white text-sm hover:bg-slate-50"
            >
              <Settings className="h-4 w-4" />
              Ajustes
            </button>
            <button
              onClick={() => setShowNew(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Nueva ficha
            </button>
          </>
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
      {showSettings && <GmbSettings onClose={() => setShowSettings(false)} />}
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
  const [tab, setTab] = useState<"reviews" | "seo" | "competitors">("reviews");

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
        <div className="flex gap-1 px-4 pt-3">
          {([
            ["reviews", "Reseñas", MessageSquare],
            ["seo", "SEO", Gauge],
            ["competitors", "Competencia", Users]
          ] as const).map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium border-b-2 " +
                (tab === k ? "border-brand-500 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {tab === "seo" && <SeoPanel id={id} />}
        {tab === "competitors" && <CompetitorsPanel id={id} />}

        {tab === "reviews" && (
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
        )}
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

function SeoPanel({ id }: { id: string }) {
  const [audit, setAudit] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`/api/v1/gmb/clients/${id}/seo-audit`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAudit(d?.audit ?? null))
      .finally(() => setLoading(false));
  }, [id]);
  if (loading)
    return (
      <div className="p-6 text-sm text-slate-500 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Analizando…
      </div>
    );
  if (!audit) return <div className="p-6 text-sm text-slate-500">No se pudo calcular la auditoría.</div>;
  const tone = audit.score >= 80 ? "text-emerald-600" : audit.score >= 50 ? "text-amber-600" : "text-rose-600";
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className={"text-3xl font-bold " + tone}>{audit.score}</div>
        <div className="text-xs text-slate-500">Puntuación SEO local (0-100)</div>
      </div>
      <div className="space-y-1">
        {audit.checks.map((c: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-[13px]">
            {c.ok ? (
              <Check className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <X className="h-4 w-4 text-rose-500 shrink-0" />
            )}
            <span className={c.ok ? "text-slate-700" : "text-slate-900 font-medium"}>{c.label}</span>
          </div>
        ))}
      </div>
      {audit.recommendations?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-amber-900 mb-1">Recomendaciones</div>
          <ul className="text-[12px] text-amber-900 list-disc pl-4 space-y-0.5">
            {audit.recommendations.map((r: string, i: number) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CompetitorsPanel({ id }: { id: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/v1/gmb/clients/${id}/competitors`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error?.message ?? "Error");
        return d;
      })
      .then(setData)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [id]);
  if (loading)
    return (
      <div className="p-6 text-sm text-slate-500 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Buscando competidores…
      </div>
    );
  if (err)
    return (
      <div className="p-4">
        <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-3">
          {err.includes("Maps") || err.includes("key")
            ? "Falta la Google Maps API key. Configúrala en Ajustes de GMB Hub para ver la competencia."
            : err}
        </div>
      </div>
    );
  if (!data) return null;
  return (
    <div className="p-4 space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-white rounded-lg border p-2">
          <div className="text-[10px] text-slate-500">Tu ficha</div>
          <div className="text-sm font-semibold">
            {data.client.rating?.toFixed(1)}★ · {data.client.reviewCount}
          </div>
        </div>
        <div className="bg-white rounded-lg border p-2">
          <div className="text-[10px] text-slate-500">Media mercado</div>
          <div className="text-sm font-semibold">
            {data.market.avgRating?.toFixed(1)}★ · {data.market.avgReviews}
          </div>
        </div>
        <div className="bg-white rounded-lg border p-2">
          <div className="text-[10px] text-slate-500">Competidores</div>
          <div className="text-sm font-semibold">{data.market.count}</div>
        </div>
      </div>
      <div className="space-y-1.5">
        {data.competitors.map((c: any, i: number) => (
          <div key={i} className="bg-white rounded-lg border p-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[13px] font-medium truncate">{c.name}</div>
              <div className="text-[11px] text-slate-500 truncate">{c.address}</div>
            </div>
            <div className="text-xs text-slate-700 whitespace-nowrap inline-flex items-center gap-1">
              <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
              {c.rating?.toFixed(1)} · {c.reviewCount}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GmbSettings({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<any>(null);
  const [allowed, setAllowed] = useState(true);
  const [webhookToken, setWebhookToken] = useState("");
  const [replyWebhookUrl, setReplyWebhookUrl] = useState("");
  const [mapsKey, setMapsKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/v1/admin/gmb-settings")
      .then((r) => {
        if (r.status === 403) {
          setAllowed(false);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        if (d) {
          setCfg(d);
          setReplyWebhookUrl(d.replyWebhookUrl ?? "");
        }
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/gmb-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookToken: webhookToken.trim() || undefined,
          replyWebhookUrl,
          mapsKey: mapsKey.trim() || undefined
        })
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error?.message ?? "Error");
      setMsg("Guardado.");
      setWebhookToken("");
      setMapsKey("");
      const d = await fetch("/api/v1/admin/gmb-settings").then((x) => x.json());
      setCfg(d);
    } catch (e: any) {
      setMsg(e?.message ?? "Error");
    } finally {
      setSaving(false);
    }
  }

  const ingestUrl = cfg ? `${cfg.incomingWebhookUrl}` : "";

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white">
          <div className="font-semibold text-sm">Ajustes de GMB Hub</div>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        {!allowed ? (
          <div className="p-6 text-sm text-slate-500">Solo un administrador puede editar estos ajustes.</div>
        ) : (
          <div className="p-4 space-y-4">
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1">Entrada de reseñas (configura esto en Make)</div>
              <p className="text-[11px] text-slate-500 mb-1.5">
                En tu escenario de Make, haz un POST a esta URL con el JSON de cada reseña, incluyendo{" "}
                <code>workspaceId</code> y <code>token</code>.
              </p>
              <div className="flex items-center gap-2">
                <input readOnly value={ingestUrl} className="flex-1 px-2 py-1.5 rounded-lg border text-[11px] font-mono bg-slate-50" />
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(ingestUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="h-8 w-8 grid place-items-center rounded-lg border hover:bg-slate-50"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              {cfg?.workspaceId && (
                <p className="text-[11px] text-slate-500 mt-1">
                  workspaceId: <code className="font-mono">{cfg.workspaceId}</code>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Token del webhook {cfg?.hasWebhookToken && <span className="text-emerald-600">· configurado ({cfg.webhookTokenMasked})</span>}
              </label>
              <input
                type="password"
                value={webhookToken}
                onChange={(e) => setWebhookToken(e.target.value)}
                placeholder={cfg?.hasWebhookToken ? "•••• (pega uno nuevo para cambiarlo)" : "Inventa un token secreto"}
                className="w-full px-3 py-2 rounded-lg border text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">URL del webhook de Make para PUBLICAR respuestas en Google</label>
              <input
                value={replyWebhookUrl}
                onChange={(e) => setReplyWebhookUrl(e.target.value)}
                placeholder="https://hook.eu1.make.com/..."
                className="w-full px-3 py-2 rounded-lg border text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Google Maps API key {cfg?.hasMapsKey && <span className="text-emerald-600">· configurada</span>}
              </label>
              <input
                type="password"
                value={mapsKey}
                onChange={(e) => setMapsKey(e.target.value)}
                placeholder={cfg?.hasMapsKey ? "•••• guardada" : "Para competencia/ranking (Fase 2)"}
                className="w-full px-3 py-2 rounded-lg border text-sm font-mono"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />}
                Guardar
              </button>
              {msg && <span className="text-xs text-slate-600">{msg}</span>}
            </div>
          </div>
        )}
      </div>
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
