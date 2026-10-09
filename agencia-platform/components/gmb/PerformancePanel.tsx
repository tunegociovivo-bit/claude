"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Eye, Search, MousePointerClick, Phone, Navigation, Globe, MessageCircle, CalendarCheck, UtensilsCrossed } from "lucide-react";

const PERIODS = [
  [-1, "Mes anterior"],
  [30, "30 días"],
  [90, "3 meses"],
  [180, "6 meses"],
  [365, "12 meses"]
] as const;

const nf = new Intl.NumberFormat("es-ES");
const fmt = (n: number | null | undefined) => (n == null ? "–" : nf.format(Math.round(n)));

function Delta({ now, prev }: { now: number; prev: number }) {
  if (!prev && !now) return null;
  if (!prev) return <span className="text-[10px] text-emerald-600 font-medium">nuevo</span>;
  const pct = ((now - prev) / prev) * 100;
  const up = pct >= 0;
  return (
    <span className={`text-[10px] font-medium ${up ? "text-emerald-600" : "text-rose-600"}`} title={`Periodo anterior: ${fmt(prev)}`}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(pct > -10 && pct < 10 ? 1 : 0)}%
    </span>
  );
}

function Kpi({ icon: Icon, label, now, prev, accent }: { icon: any; label: string; now: number; prev?: number; accent?: string }) {
  return (
    <div className="bg-white rounded-lg border p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <Icon className={`h-3.5 w-3.5 ${accent ?? "text-slate-400"}`} />
        {label}
      </div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <div className="text-lg font-semibold text-slate-900 tabular-nums">{fmt(now)}</div>
        {prev != null && <Delta now={now} prev={prev} />}
      </div>
    </div>
  );
}

type Day = { date: string; views: number; interactions: number };

function TrendChart({ daily }: { daily: Day[] }) {
  // Agrupa por semanas si el periodo es largo, para que las barras se lean.
  const pts = useMemo(() => {
    if (daily.length <= 45) return daily.map((d) => ({ label: d.date, views: d.views, interactions: d.interactions }));
    const out: { label: string; views: number; interactions: number }[] = [];
    for (let i = 0; i < daily.length; i += 7) {
      const chunk = daily.slice(i, i + 7);
      out.push({
        label: `${chunk[0].date} → ${chunk[chunk.length - 1].date}`,
        views: chunk.reduce((s, d) => s + d.views, 0),
        interactions: chunk.reduce((s, d) => s + d.interactions, 0)
      });
    }
    return out;
  }, [daily]);
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 150;
  const pad = { l: 4, r: 4, t: 8, b: 18 };
  const maxV = Math.max(1, ...pts.map((p) => p.views));
  const maxI = Math.max(1, ...pts.map((p) => p.interactions));
  const bw = (W - pad.l - pad.r) / pts.length;
  const y = (v: number, m: number) => pad.t + (H - pad.t - pad.b) * (1 - v / m);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${pad.l + bw * i + bw / 2},${y(p.interactions, maxI)}`).join(" ");
  const h = hover != null ? pts[hover] : null;
  const weekly = daily.length > 45;
  return (
    <div className="bg-white rounded-lg border p-3">
      <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-400" /> Visualizaciones{weekly ? " / semana" : " / día"}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 bg-amber-500" /> Interacciones
          </span>
        </div>
        <div className="tabular-nums text-slate-700">{h ? `${h.label}: ${fmt(h.views)} vis. · ${fmt(h.interactions)} int.` : ""}</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" onMouseLeave={() => setHover(null)} role="img" aria-label="Evolución de visualizaciones e interacciones">
        {pts.map((p, i) => {
          const top = y(p.views, maxV);
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={pad.l + bw * i} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              <rect
                x={pad.l + bw * i + Math.min(1, bw * 0.15)}
                y={top}
                width={Math.max(1, bw - Math.min(2, bw * 0.3))}
                height={Math.max(0, H - pad.b - top)}
                rx={Math.min(2, bw / 4)}
                className={hover === i ? "fill-sky-500" : "fill-sky-300"}
              />
            </g>
          );
        })}
        <path d={line} fill="none" stroke="#f59e0b" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
        <text x={pad.l} y={H - 4} fontSize="10" fill="#94a3b8">{pts[0]?.label.split(" ")[0]}</text>
        <text x={W - pad.r} y={H - 4} fontSize="10" fill="#94a3b8" textAnchor="end">{pts[pts.length - 1]?.label.split(" → ").pop()}</text>
      </svg>
    </div>
  );
}

export default function PerformancePanel({ id }: { id: string }) {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [allKw, setAllKw] = useState(false);

  function load(fresh = false) {
    setLoading(true);
    setErr(null);
    fetch(`/api/v1/gmb/clients/${id}/performance?${days === -1 ? "month=prev" : `days=${days}`}${fresh ? "&fresh=1" : ""}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.message || "No se pudo obtener el rendimiento.");
        setData(d);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, days]);

  const t = data?.totals ?? {};
  const cmp = !!data?.prevRange?.complete;
  const p = cmp ? data?.prevTotals ?? {} : {};
  const viewParts = data
    ? [
        ["Búsqueda de Google · móvil", t.BUSINESS_IMPRESSIONS_MOBILE_SEARCH ?? 0],
        ["Búsqueda de Google · ordenador", t.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH ?? 0],
        ["Google Maps · móvil", t.BUSINESS_IMPRESSIONS_MOBILE_MAPS ?? 0],
        ["Google Maps · ordenador", t.BUSINESS_IMPRESSIONS_DESKTOP_MAPS ?? 0]
      ]
    : [];
  const optional = [
    ["BUSINESS_CONVERSATIONS", "Mensajes", MessageCircle],
    ["BUSINESS_BOOKINGS", "Reservas", CalendarCheck],
    ["BUSINESS_FOOD_ORDERS", "Pedidos de comida", UtensilsCrossed],
    ["BUSINESS_FOOD_MENU_CLICKS", "Clics en el menú", UtensilsCrossed]
  ] as const;

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border bg-white p-0.5 text-xs">
          {PERIODS.map(([d, label]) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-md ${days === d ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => load(true)} disabled={loading} className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border bg-white hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Actualizar desde Google
        </button>
      </div>

      {loading && !data && (
        <div className="p-6 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Obteniendo el rendimiento de Google…
        </div>
      )}
      {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-3">{err}</div>}

      {data && (
        <div className={`space-y-3 ${loading ? "opacity-60" : ""}`}>
          <div className="text-[11px] text-slate-500">
            Del {data.range.since} al {data.range.until}
            {data.prevRange.complete
              ? `, comparado con ${data.prevRange.since} – ${data.prevRange.until}.`
              : ". Sin comparación: Google solo conserva unos 18 meses de datos."} Google publica los datos con unos días de retraso, por eso el periodo
            termina en el último día disponible.
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Kpi icon={Eye} label="Visualizaciones del perfil" now={data.views} prev={cmp ? data.prevViews : undefined} accent="text-sky-500" />
            <Kpi icon={Search} label="Búsquedas que te mostraron" now={data.searches} accent="text-violet-500" />
            <Kpi icon={MousePointerClick} label="Interacciones" now={data.interactions} prev={cmp ? data.prevInteractions : undefined} accent="text-amber-500" />
          </div>

          <TrendChart daily={data.daily} />

          <div className="grid grid-cols-3 gap-2">
            <Kpi icon={Phone} label="Llamadas" now={t.CALL_CLICKS ?? 0} prev={cmp ? p.CALL_CLICKS ?? 0 : undefined} />
            <Kpi icon={Navigation} label="Cómo llegar" now={t.BUSINESS_DIRECTION_REQUESTS ?? 0} prev={cmp ? p.BUSINESS_DIRECTION_REQUESTS ?? 0 : undefined} />
            <Kpi icon={Globe} label="Clics en el sitio web" now={t.WEBSITE_CLICKS ?? 0} prev={cmp ? p.WEBSITE_CLICKS ?? 0 : undefined} />
            {optional
              .filter(([m]) => (t[m] ?? 0) > 0 || (p[m] ?? 0) > 0)
              .map(([m, label, Icon]) => (
                <Kpi key={m} icon={Icon} label={label} now={t[m] ?? 0} prev={cmp ? p[m] ?? 0 : undefined} />
              ))}
          </div>

          <div className="bg-white rounded-lg border p-3">
            <div className="text-xs font-medium text-slate-700 mb-2">Plataforma y dispositivo de las visualizaciones</div>
            <div className="space-y-1.5">
              {viewParts.map(([label, v]) => {
                const pct = data.views ? ((v as number) / data.views) * 100 : 0;
                return (
                  <div key={label as string} className="text-[12px]">
                    <div className="flex justify-between text-slate-600">
                      <span>{label}</span>
                      <span className="tabular-nums">
                        {fmt(v as number)} <span className="text-slate-400">· {pct.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 mt-0.5">
                      <div className="h-1.5 rounded-full bg-sky-400" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-lg border p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-slate-700">Búsquedas con las que te encontraron</div>
              <div className="text-[10px] text-slate-400">meses {data.keywordsMonths}</div>
            </div>
            {data.keywords.length === 0 ? (
              <div className="text-[12px] text-slate-500">Google aún no tiene datos de búsquedas para este periodo.</div>
            ) : (
              <>
                <div className="divide-y">
                  {(allKw ? data.keywords : data.keywords.slice(0, 15)).map((k: any, i: number) => (
                    <div key={k.keyword + i} className="flex items-center justify-between py-1 text-[12px]">
                      <span className="text-slate-700 truncate">
                        <span className="text-slate-400 tabular-nums mr-2">{i + 1}.</span>
                        {k.keyword}
                      </span>
                      <span className="tabular-nums text-slate-600 whitespace-nowrap">{k.impressions != null ? fmt(k.impressions) : `< ${k.threshold ?? 15}`}</span>
                    </div>
                  ))}
                </div>
                {data.keywords.length > 15 && (
                  <button onClick={() => setAllKw(!allKw)} className="mt-2 text-[12px] text-brand-700 hover:underline">
                    {allKw ? "Ver menos" : `Ver las ${data.keywords.length} búsquedas`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
      <SheetLink id={id} />
    </div>
  );
}

/** Vinculación con el Google Sheets «Informe GMB» del cliente. */
function SheetLink({ id }: { id: string }) {
  const [url, setUrl] = useState("");
  const [saved, setSaved] = useState("");
  const [sa, setSa] = useState<string | null>(null);
  const [saErr, setSaErr] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/gmb/clients/${id}/sheet`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setUrl(d.url ?? "");
        setSaved(d.url ?? "");
        setSa(d.serviceAccount);
        setSaErr(d.serviceAccountError);
        setSyncedAt(d.syncedAt);
      });
  }, [id]);

  function describe(d: any) {
    if (!d.ok) return { text: d.message || "No se pudo sincronizar.", ok: false };
    const parts: string[] = [];
    if (d.written?.length) {
      const months = [...new Set(d.written.flatMap((w: any) => w.months))].sort() as string[];
      parts.push(`Añadidos ${months.length} ${months.length === 1 ? "mes" : "meses"} (${months.map((m) => m.slice(5) + "/" + m.slice(0, 4)).join(", ")}) en ${d.written.length} pestañas.`);
    } else if (d.upToDate) parts.push("La hoja ya estaba al día.");
    if (d.pendingMonth) parts.push(`El mes ${d.pendingMonth.slice(5)}/${d.pendingMonth.slice(0, 4)} se añadirá solo en cuanto Google publique todos sus datos (unos días después de cerrar el mes).`);
    if (d.missingTabs?.length) parts.push(`No encuentro las pestañas: ${d.missingTabs.join(", ")}.`);
    return { text: parts.join(" "), ok: !d.missingTabs?.length };
  }

  async function post(body: any) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${id}/sheet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({ ok: false, message: "Error" }));
      if (body.url !== undefined && (d.ok || d.url === "")) setSaved(d.url ?? body.url);
      if (d.syncedAt) setSyncedAt(d.syncedAt);
      setMsg(body.url === "" ? { text: "Hoja desvinculada.", ok: true } : describe(d));
    } finally {
      setBusy(false);
    }
  }

  const dirty = url.trim() !== saved.trim();
  return (
    <div className="bg-white rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-slate-700">Spreadsheet del informe del cliente</div>
        {saved && !dirty && (
          <a href={saved} target="_blank" rel="noreferrer" className="text-[11px] text-brand-700 hover:underline">
            Abrir hoja ↗
          </a>
        )}
      </div>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          post({ url: url.trim() });
        }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          className="flex-1 min-w-0 border rounded-md px-2 py-1.5 text-[12px]"
        />
        {dirty ? (
          <button type="submit" disabled={busy} className="text-xs px-2.5 py-1.5 rounded-md bg-slate-900 text-white disabled:opacity-50">
            {busy ? "Vinculando…" : url.trim() ? "Vincular" : "Desvincular"}
          </button>
        ) : saved ? (
          <button type="button" onClick={() => post({ action: "sync" })} disabled={busy} className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border bg-white hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Sincronizar
          </button>
        ) : null}
      </form>
      {sa ? (
        <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-1">
          Comparte la hoja como <b>Editor</b> con
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(sa).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="font-mono text-[10.5px] bg-slate-100 rounded px-1.5 py-0.5 hover:bg-slate-200"
            title="Copiar"
          >
            {sa}
          </button>
          {copied ? <span className="text-emerald-600">copiado</span> : null}
        </div>
      ) : saErr ? (
        <div className="text-[11px] text-rose-600">{saErr}</div>
      ) : null}
      <div className="text-[10.5px] text-slate-400">
        Cada mes se añaden solas las filas del mes cerrado en «Vistas perfil empresa», «Llamadas», «Cómo llegar», «Clicks sitio web» y «Palabras Clave» (nunca se modifican las filas existentes).
        {syncedAt ? ` Última sincronización: ${new Date(syncedAt).toLocaleString("es-ES")}.` : ""}
      </div>
      {msg && <div className={`text-[11px] ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.text}</div>}
    </div>
  );
}
