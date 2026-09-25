"use client";

/**
 * GMB Hub · Reseñas falsas. Cruza las reseñas negativas de una ficha con las reseñas de la
 * competencia (SerpApi), puntúa cada perfil autor y genera un informe para el cliente.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, ShieldAlert, Plus, X, Trash2, ExternalLink, Link2, RotateCcw, ArrowLeft, Check, Download } from "lucide-react";
import FakeReviewReport from "@/components/gmb/FakeReviewReport";
import { GoogleCaseView, LetterView, downloadPdf } from "@/components/gmb/FakeReviewGoogle";
import type { Place } from "@/lib/gmb/fake-reviews/core";
import type { AnalysisResults } from "@/lib/gmb/fake-reviews/analyzer";

type Row = {
  id: string;
  clientName: string;
  label: string;
  status: string;
  progress: number;
  stepLabel: string;
  apiCalls: number;
  lastError: string | null;
  createdAt: string;
};
type Ficha = { id: string; name: string; placeId?: string; address?: string };

const CARD = "bg-white rounded-xl border p-4";
const BTN = "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium";
const BTN_PRIMARY = `${BTN} bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50`;
const BTN_SEC = `${BTN} border bg-white hover:bg-slate-50`;

async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error?.message ?? d?.message ?? `Error ${r.status}`);
  return d as T;
}

function Stars({ n }: { n: number | null }) {
  const r = Math.round(n ?? 0);
  return (
    <span className="whitespace-nowrap">
      <span className="text-amber-400">{"★".repeat(r)}</span>
      <span className="text-slate-300">{"★".repeat(Math.max(0, 5 - r))}</span>
    </span>
  );
}

function PlaceChip({ p, onClear, onPick }: { p: Place; onClear?: () => void; onPick?: () => void }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${onClear ? "border-amber-400 bg-amber-50/50" : "bg-slate-50"}`}>
      {p.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.thumbnail} alt="" referrerPolicy="no-referrer" className="h-11 w-11 rounded-md object-cover" />
      ) : (
        <div className="h-11 w-11 rounded-md bg-slate-200" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{p.title}</div>
        <div className="text-xs text-slate-500 truncate">{p.address}{p.type ? ` · ${p.type}` : ""}</div>
        <div className="text-xs">
          {p.rating != null && <><b>{p.rating.toFixed(1).replace(".", ",")}</b> <Stars n={p.rating} /> </>}
          {p.reviews != null && <span className="text-slate-500">{p.reviews} reseñas</span>}
        </div>
      </div>
      {onPick && <button onClick={onPick} className={BTN_SEC}>Elegir</button>}
      {onClear && (
        <button onClick={onClear} className="text-xs text-slate-500 hover:text-slate-800 underline">Cambiar</button>
      )}
    </div>
  );
}

function PlacePicker({
  label,
  value,
  onChange,
  fichas,
  onFicha,
  placeholder,
  onRemove
}: {
  label: string;
  value: Place | null;
  onChange: (p: Place | null) => void;
  fichas?: Ficha[];
  onFicha?: (id: string | null) => void;
  placeholder: string;
  onRemove?: () => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cands, setCands] = useState<Place[]>([]);

  async function find(query = q) {
    if (!query.trim()) return;
    setBusy(true);
    setErr(null);
    setCands([]);
    try {
      const d = await api<{ place?: Place; candidates?: Place[] }>("/api/v1/gmb/fake-reviews/resolve", { method: "POST", body: JSON.stringify({ q: query.trim() }) });
      if (d.place) onChange(d.place);
      else setCands(d.candidates ?? []);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-slate-700">{label}</label>
        {onRemove && (
          <button onClick={onRemove} className="text-xs text-rose-600 hover:underline">Quitar</button>
        )}
      </div>
      {value ? (
        <PlaceChip p={value} onClear={() => { onChange(null); onFicha?.(null); }} />
      ) : (
        <>
          {fichas && fichas.length > 0 && (
            <select
              className="w-full px-3 py-2 rounded-lg border text-sm bg-white"
              defaultValue=""
              onChange={(e) => {
                const f = fichas.find((x) => x.id === e.target.value);
                if (!f) return;
                onFicha?.(f.id);
                const query = f.placeId ? `place_id:${f.placeId}` : `${f.name} ${f.address ?? ""}`.trim();
                setQ(f.placeId ? f.name : query);
                find(query);
              }}
            >
              <option value="" disabled>Elegir una ficha del GMB Hub…</option>
              {fichas.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}
          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), find())}
              placeholder={placeholder}
              className="flex-1 px-3 py-2 rounded-lg border text-sm"
            />
            <button onClick={() => find()} disabled={busy || !q.trim()} className={BTN_SEC}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Buscar
            </button>
          </div>
          {err && <p className="text-xs text-rose-600">{err}</p>}
          {cands.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-slate-500">Varias coincidencias, elige la correcta:</p>
              {cands.map((c, i) => (
                <PlaceChip key={i} p={c} onPick={() => { onChange(c); setCands([]); }} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────────────────── Formulario ───────────────────────── */

type SourceInfo = { configured: boolean; provider?: "serpapi" | "serper" | null; origin?: string; supportsContributor?: boolean; left?: number | null; plan?: string };

function NewAnalysis({ onCreated, source }: { onCreated: (id: string) => void; source: SourceInfo | null }) {
  const hasKey = source ? source.configured : null;
  const history = !!source?.supportsContributor;
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [client, setClient] = useState<Place | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [comps, setComps] = useState<(Place | null)[]>([null]);
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [kind, setKind] = useState<"cruce" | "policy">("cruce");
  const [policy, setPolicy] = useState(true);
  const [minOverlap, setMinOverlap] = useState(2);
  const [negThreshold, setNeg] = useState(2);
  const [posThreshold, setPos] = useState(4);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [windowDays, setWindow] = useState(30);
  const [deep, setDeep] = useState(true);
  const [maxDeep, setMaxDeep] = useState(80);
  const [ai, setAi] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/gmb/clients").then((r) => (r.ok ? r.json() : null)).then((d) => d && setFichas(d.clients ?? [])).catch(() => {});
  }, []);

  const chosen = comps.filter(Boolean) as Place[];

  const onlyPolicy = kind === "policy";
  const auto = !onlyPolicy && mode === "auto";
  const estimate = useMemo(() => {
    if (!client || (!auto && !onlyPolicy && !chosen.length)) return null;
    const share = negThreshold === 1 ? 0.07 : negThreshold === 2 ? 0.11 : 0.16;
    const negN = Math.max(3, Math.round((client.reviews ?? 100) * share));
    let calls = 1 + Math.ceil(negN / 20);
    let frac = 1;
    if (dateFrom) {
      const months = (Date.now() - Date.parse(dateFrom)) / 2.63e9;
      frac = Math.min(1, Math.max(0.15, months / 48));
    }
    if (onlyPolicy) return calls;
    if (auto && !history) return calls + 1 + 8 * 6;
    if (auto) return calls + Math.min(maxDeep, Math.round(negN * (dateFrom ? frac * 1.5 : 1))) + 5;
    for (const c of chosen) calls += Math.min(25, 1 + Math.ceil(((c.reviews ?? 100) * frac) / 20));
    if (deep && history) calls += Math.min(maxDeep, Math.round(negN * (dateFrom ? frac * 1.5 : 1)));
    return calls;
  }, [client, chosen, negThreshold, dateFrom, deep, maxDeep, auto, history, onlyPolicy]);

  async function start() {
    setErr(null);
    if (!client) return setErr("Busca y selecciona la ficha del cliente.");
    if (!auto && !onlyPolicy && !chosen.length) return setErr("Busca y selecciona al menos un competidor o usa la detección automática.");
    setBusy(true);
    try {
      const d = await api<{ id: string }>("/api/v1/gmb/fake-reviews", {
        method: "POST",
        body: JSON.stringify({
          mode: onlyPolicy ? "policy" : mode, policy: onlyPolicy || policy, minOverlap, clientId: clientId ?? undefined, client,
          competitors: auto || onlyPolicy ? [] : chosen,
          negThreshold, posThreshold, windowDays, dateFrom, deep: onlyPolicy ? false : auto ? true : deep && history, maxDeep, ai
        })
      });
      onCreated(d.id);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-4">
      <div className="space-y-4">
        {hasKey === false && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            No hay proveedor de reseñas. Añade la API key de <b>SerpApi</b> en GMB Hub → Ajustes (análisis completo) o la de <b>Serper.dev</b> en
            Publicador SEO → Ajustes.
          </div>
        )}
        {source?.provider === "serper" && (
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
            Usando <b>Serper.dev</b> (la clave del Publicador SEO). Lee todas las reseñas del cliente y de la competencia, pero no el historial de
            cada perfil: la investigación profunda no está disponible y la detección automática hace un barrido de los negocios del mismo
            sector cercanos. Con una key de SerpApi en Ajustes el análisis es completo.
          </div>
        )}
        <div className={`${CARD} space-y-2`}>
          <div className="text-xs font-semibold text-slate-700">Tipo de análisis</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {([
              ["cruce", "Cruce con la competencia", "Perfiles que ponen negativas al cliente y positivas a la competencia (+ revisión de contenido opcional)."],
              ["policy", "Revisión de contenido", "La IA revisa cada reseña negativa buscando insultos, lenguaje soez, emojis despectivos, datos personales… que incumplen las políticas de Google."]
            ] as const).map(([k, t, d]) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`text-left rounded-lg border p-3 ${kind === k ? "border-amber-400 bg-amber-50/60" : "hover:bg-slate-50"}`}
              >
                <div className="text-sm font-medium">{t}</div>
                <div className="text-xs text-slate-500">{d}</div>
              </button>
            ))}
          </div>
        </div>
        <div className={CARD}>
          <PlacePicker
            label="1 · Ficha del cliente"
            value={client}
            onChange={setClient}
            fichas={fichas}
            onFicha={setClientId}
            placeholder="Nombre + ciudad, URL de Google Maps, maps.app.goo.gl o Place ID"
          />
        </div>
        {!onlyPolicy && (
        <div className={`${CARD} space-y-3`}>
          <div className="text-xs font-semibold text-slate-700">2 · Competencia</div>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
            {([
              ["manual", "Competidores concretos"],
              ["auto", "Detectar automáticamente"]
            ] as const).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setMode(k)}
                className={"px-3 py-1.5 rounded-md text-sm font-medium " + (mode === k ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-800")}
              >
                {l}
              </button>
            ))}
          </div>
          {auto ? (
            <div className="text-sm text-slate-600 space-y-2">
              {history ? (
                <p>
                  Se revisa el historial público de cada perfil que ha dejado una reseña negativa al cliente y se buscan los negocios
                  a los que <b>varios de esos perfiles</b> han puesto reseñas positivas. Los del mismo sector pasan a analizarse como competencia.
                </p>
              ) : (
                <p>
                  Se buscan hasta 8 negocios <b>del mismo sector cercanos</b> al cliente, se leen sus reseñas recientes y se detectan los que
                  reciben reseñas positivas de <b>varios</b> de los perfiles que dejaron negativas al cliente.
                </p>
              )}
              <label className="flex items-center gap-2 text-xs text-slate-600">
                Mínimo de perfiles en común
                <input type="number" min={2} max={20} value={minOverlap} onChange={(e) => setMinOverlap(Math.max(2, Number(e.target.value) || 2))} className="w-16 px-2 py-1 rounded-lg border text-sm" />
              </label>
            </div>
          ) : (
          <div className="space-y-4">
          {comps.map((c, i) => (
            <PlacePicker
              key={i}
              label={`Competidor ${i + 1}`}
              value={c}
              onChange={(p) => setComps((arr) => arr.map((x, j) => (j === i ? p : x)))}
              placeholder="Nombre o URL del competidor"
              onRemove={comps.length > 1 ? () => setComps((arr) => arr.filter((_, j) => j !== i)) : undefined}
            />
          ))}
          {comps.length < 5 && (
            <button onClick={() => setComps((a) => [...a, null])} className="text-sm text-brand-600 hover:underline inline-flex items-center gap-1">
              <Plus className="h-4 w-4" /> Añadir otro competidor
            </button>
          )}
          </div>
          )}
        </div>
        )}
      </div>

      <div className={`${CARD} space-y-3 h-fit`}>
        <div className="text-xs font-semibold text-slate-700">3 · Parámetros</div>
        <label className="block text-xs text-slate-600">
          Reseñas negativas del cliente
          <select value={negThreshold} onChange={(e) => setNeg(Number(e.target.value))} className="mt-1 w-full px-2 py-1.5 rounded-lg border text-sm bg-white">
            <option value={1}>Sólo 1★</option>
            <option value={2}>1★ y 2★</option>
            <option value={3}>1★ a 3★</option>
          </select>
        </label>
        {!onlyPolicy && (
        <label className="block text-xs text-slate-600">
          «Positiva» en la competencia
          <select value={posThreshold} onChange={(e) => setPos(Number(e.target.value))} className="mt-1 w-full px-2 py-1.5 rounded-lg border text-sm bg-white">
            <option value={4}>4★ y 5★</option>
            <option value={5}>Sólo 5★</option>
          </select>
        </label>
        )}
        <label className="block text-xs text-slate-600">
          Analizar desde (vacío = todo)
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="mt-1 w-full px-2 py-1.5 rounded-lg border text-sm" />
        </label>
        {!onlyPolicy && (<>
        <label className="block text-xs text-slate-600">
          Ventana entre negativa y positiva (días)
          <input type="number" min={1} max={365} value={windowDays} onChange={(e) => setWindow(Number(e.target.value) || 30)} className="mt-1 w-full px-2 py-1.5 rounded-lg border text-sm" />
        </label>
        <label className={`flex items-start gap-2 text-xs text-slate-700 ${auto || !history ? "opacity-60" : ""}`}>
          <input type="checkbox" checked={history && (auto || deep)} disabled={auto || !history} onChange={(e) => setDeep(e.target.checked)} className="mt-0.5" />
          <span>
            <b>Investigación profunda</b>: historial completo de cada perfil (cruces antiguos, ataques al sector, cuentas nuevas). 1 búsqueda por perfil.
          </span>
        </label>
        {history && (auto || deep) && (
          <label className="block text-xs text-slate-600">
            Máx. perfiles a investigar
            <input type="number" min={1} max={300} value={maxDeep} onChange={(e) => setMaxDeep(Number(e.target.value) || 80)} className="mt-1 w-full px-2 py-1.5 rounded-lg border text-sm" />
          </label>
        )}
        <label className="flex items-start gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={policy} onChange={(e) => setPolicy(e.target.checked)} className="mt-0.5" />
          <span>
            <b>Revisar también el contenido</b> de cada reseña negativa con IA (insultos, lenguaje soez, emojis despectivos, datos personales…).
          </span>
        </label>
        </>)}
        <label className="flex items-start gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} className="mt-0.5" />
          <span>Resumen ejecutivo redactado con Claude</span>
        </label>
        <div className="rounded-lg bg-slate-900 text-white text-xs px-3 py-2">
          Consumo estimado: <b className="text-amber-300">{estimate ? `≈ ${estimate}` : "—"}</b> búsquedas SerpApi
        </div>
        {err && <p className="text-xs text-rose-600">{err}</p>}
        <button onClick={start} disabled={busy || !client || (!auto && !onlyPolicy && !chosen.length)} className={`${BTN_PRIMARY} w-full justify-center`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />} Iniciar análisis
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── Detalle ───────────────────────── */

function AnalysisDetail({ id, onBack, onDeleted }: { id: string; onBack: () => void; onDeleted: () => void }) {
  const [a, setA] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [share, setShare] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"cliente" | "google" | "carta">("cliente");
  const [pdfBusy, setPdfBusy] = useState(false);
  const running = useRef(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const d = await api<{ analysis: any }>(`/api/v1/gmb/fake-reviews/${id}`);
      setA(d.analysis);
      return d.analysis;
    } catch (e: any) {
      setErr(e.message);
      return null;
    }
  }, [id]);

  const pump = useCallback(
    async (resume = false) => {
      if (running.current) return;
      running.current = true;
      let first = true;
      try {
        while (alive.current) {
          const s = await api<any>(`/api/v1/gmb/fake-reviews/${id}/step`, { method: "POST", body: JSON.stringify({ resume: resume && first }) });
          first = false;
          setA((prev: any) => ({ ...(prev ?? {}), status: s.status, progress: s.progress, stepLabel: s.step, apiCalls: s.calls, lastError: s.error }));
          if (s.status !== "running") {
            await load();
            break;
          }
          await new Promise((r) => setTimeout(r, 400));
        }
      } catch (e: any) {
        setErr(e.message);
      } finally {
        running.current = false;
      }
    },
    [id, load]
  );

  useEffect(() => {
    alive.current = true;
    load().then((row) => {
      if (row?.status === "running") pump();
    });
    return () => {
      alive.current = false;
    };
  }, [load, pump]);

  async function makeShare() {
    try {
      const d = await api<{ url: string }>(`/api/v1/gmb/fake-reviews/${id}/share`, { method: "POST", body: JSON.stringify({ expiryDays: 60 }) });
      setShare(d.url);
      await navigator.clipboard?.writeText(d.url).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e: any) {
      setErr(e.message);
    }
  }
  async function revokeShare() {
    await api(`/api/v1/gmb/fake-reviews/${id}/share`, { method: "DELETE" }).catch(() => {});
    setShare(null);
    load();
  }
  async function del() {
    if (!confirm("¿Borrar este análisis? No se puede deshacer.")) return;
    await api(`/api/v1/gmb/fake-reviews/${id}`, { method: "DELETE" }).catch((e) => setErr(e.message));
    onDeleted();
  }
  function csv() {
    const res: AnalysisResults = a.results;
    const comps = res.competitors;
    const q = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      ["Perfil", "ID contribuidor", "URL perfil", "Reseñas totales", "Local Guide", "Riesgo", "Puntuación", "Estrellas al cliente", "Fecha", "Texto", "URL reseña", "Reseñas a competencia", "Días negativa-positiva", "Señales"].map(q).join(";")
    ];
    for (const au of res.authors) {
      const comp = au.compReviews.map((c) => `${comps[c.comp ?? 0]?.title} ${c.rating}★ ${c.date}`).join(" | ");
      const sig = au.signals.map((s) => `${s.label} (${s.points})`).join(" | ");
      for (const r of au.clientReviews) {
        lines.push([au.name, au.cid, au.link, au.totalReviews, au.localGuide ? "Sí" : "No", au.level, au.score, r.rating, r.date, r.text, r.link, comp, au.gapDays ?? "", sig].map(q).join(";"));
      }
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `resenas-sospechosas-${(a.clientName ?? "cliente").replace(/[^\w-]+/g, "-")}.csv`;
    el.click();
    URL.revokeObjectURL(url);
  }

  if (!a) return <div className="py-10 grid place-items-center">{err ? <p className="text-rose-600 text-sm">{err}</p> : <Loader2 className="h-6 w-6 animate-spin text-slate-400" />}</div>;

  return (
    <div className="space-y-4">
      <div className={`${CARD} flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-slate-100" aria-label="Volver">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="font-semibold">{a.clientName}</div>
            <div className="text-xs text-slate-500">{a.label} · {new Date(a.createdAt).toLocaleString("es-ES")} · {a.apiCalls} búsquedas</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {a.status === "done" && (
            <>
              <button onClick={() => downloadPdf(id, "cliente", setPdfBusy, setErr)} disabled={pdfBusy} className={BTN_PRIMARY}>
                {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Descargar informe (PDF)
              </button>
              <a href={`/informe-resenas/i/${id}`} target="_blank" rel="noopener noreferrer" className={BTN_SEC}>
                <ExternalLink className="h-4 w-4" /> Ver / imprimir
              </a>
              <button onClick={makeShare} className={BTN_SEC}>
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Link2 className="h-4 w-4" />} {copied ? "Enlace copiado" : "Enlace para el cliente"}
              </button>
              {(a.shared || share) && (
                <button onClick={revokeShare} className={`${BTN_SEC} text-slate-500`}>Revocar enlace</button>
              )}
              <button onClick={csv} className={BTN_SEC}>Exportar CSV</button>
            </>
          )}
          {a.status === "error" && (
            <button onClick={() => pump(true)} className={BTN_PRIMARY}>
              <RotateCcw className="h-4 w-4" /> Reintentar desde donde se quedó
            </button>
          )}
          <button onClick={del} className={`${BTN_SEC} text-rose-600`}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {share && (
        <div className="rounded-lg border bg-emerald-50 border-emerald-200 text-xs px-3 py-2 break-all">
          Enlace público (60 días): <a href={share} target="_blank" rel="noopener noreferrer" className="underline">{share}</a>
        </div>
      )}
      {err && <p className="text-sm text-rose-600">{err}</p>}

      {a.status !== "done" ? (
        <div className={CARD}>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all" style={{ width: `${a.progress}%` }} />
          </div>
          <p className="text-sm mt-2">{a.progress}% · {a.stepLabel}</p>
          {a.status === "error" && <p className="text-sm text-rose-600 mt-2">{a.lastError}</p>}
          <p className="text-xs text-slate-500 mt-2">Puedes salir de esta pantalla: el análisis continúa en segundo plano y aparecerá como completado en el historial.</p>
        </div>
      ) : a.results ? (
        <>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
            {([
              ["cliente", "Informe para el cliente"],
              ["google", "Informe para Google"],
              ["carta", "Escrito a soporte"]
            ] as const).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={"px-3 py-1.5 rounded-md text-sm font-medium " + (tab === k ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-800")}
              >
                {l}
              </button>
            ))}
          </div>
          {tab === "cliente" && (
            <div className={`${CARD} sm:p-6`}>
              <FakeReviewReport results={a.results} />
            </div>
          )}
          {tab === "google" && <GoogleCaseView id={id} results={a.results} />}
          {tab === "carta" && <LetterView id={id} results={a.results} onSaved={(r) => setA((prev: any) => ({ ...prev, results: r }))} />}
        </>
      ) : null}
    </div>
  );
}

/* ───────────────────────── Vista principal ───────────────────────── */

export default function FakeReviewsView() {
  const [mode, setMode] = useState<"list" | "new">("list");
  const [sel, setSel] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [credits, setCredits] = useState<SourceInfo | null>(null);

  const loadList = useCallback(async () => {
    const d = await api<{ analyses: Row[] }>("/api/v1/gmb/fake-reviews").catch(() => ({ analyses: [] as Row[] }));
    setRows(d.analyses);
    if (!d.analyses.length) setMode("new");
  }, []);

  useEffect(() => {
    loadList();
    api("/api/v1/gmb/fake-reviews/credits").then(setCredits).catch(() => setCredits(null));
  }, [loadList]);

  if (sel) {
    return (
      <AnalysisDetail
        id={sel}
        onBack={() => { setSel(null); loadList(); }}
        onDeleted={() => { setSel(null); loadList(); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-amber-500" /> Detector de reseñas falsas</h2>
          <p className="text-xs text-slate-500">
            Cruza los autores de las reseñas negativas de un cliente con las reseñas de su competencia y genera un informe con evidencias.
            {credits?.configured && <> · Fuente: <b>{credits.provider === "serpapi" ? "SerpApi" : "Serper.dev"}</b></>}
            {credits?.configured && credits.left != null && <> ({credits.left} búsquedas disponibles)</>}
          </p>
        </div>
        <div className="flex gap-2">
          {mode === "new" ? (
            rows && rows.length > 0 && (
              <button onClick={() => setMode("list")} className={BTN_SEC}><X className="h-4 w-4" /> Cancelar</button>
            )
          ) : (
            <button onClick={() => setMode("new")} className={BTN_PRIMARY}><Plus className="h-4 w-4" /> Nuevo análisis</button>
          )}
        </div>
      </div>

      {mode === "new" ? (
        <NewAnalysis source={credits} onCreated={(id) => { setMode("list"); setSel(id); }} />
      ) : !rows ? (
        <div className="py-10 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="text-left p-3 font-medium">Cliente</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">Competencia</th>
                <th className="text-left p-3 font-medium">Estado</th>
                <th className="text-left p-3 font-medium hidden sm:table-cell">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setSel(r.id)} className="border-t hover:bg-slate-50 cursor-pointer">
                  <td className="p-3 font-medium">{r.clientName}</td>
                  <td className="p-3 text-slate-500 hidden md:table-cell truncate max-w-xs">{r.label.replace(/^vs /, "")}</td>
                  <td className="p-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        r.status === "done" ? "bg-emerald-50 text-emerald-700" : r.status === "error" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {r.status === "done" ? "Completado" : r.status === "error" ? "Error" : `${r.progress}% · en curso`}
                    </span>
                  </td>
                  <td className="p-3 text-slate-500 hidden sm:table-cell">{new Date(r.createdAt).toLocaleDateString("es-ES")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
