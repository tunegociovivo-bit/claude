"use client";

/**
 * Informe de la ficha (imprimible / PDF) con rango de fechas y dos modos:
 *  - «Real»: todos los datos tal cual, con subidas y bajadas, reseñas negativas y puntos de atención.
 *  - «Cliente»: los mismos datos, presentados destacando lo positivo. Nunca se altera una cifra:
 *    solo se elige qué mostrar y cómo (sin comparativas negativas, acumulados en vez de altibajos,
 *    reseñas destacadas en vez de la lista completa, próximos pasos en vez de alertas).
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Printer, Star, Eye, Search, MousePointerClick, Phone, Navigation, Globe, MessageCircle, CalendarCheck, Megaphone, MapPin, TrendingUp } from "lucide-react";

type Mode = "real" | "cliente";
const nf = new Intl.NumberFormat("es-ES");
const fmt = (n: number | null | undefined, d = 0) =>
  n == null || Number.isNaN(n) ? "–" : new Intl.NumberFormat("es-ES", { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
const pct = (now: number, prev: number) => (prev > 0 ? ((now - prev) / prev) * 100 : now > 0 ? null : 0);
const dIso = (d: Date) => d.toISOString().slice(0, 10);
const longDate = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
const shortDate = (s: string | Date) => new Date(s).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });

function presets() {
  const y = new Date(Date.now() - 86_400_000);
  const back = (days: number) => ({ from: dIso(new Date(y.getTime() - (days - 1) * 86_400_000)), to: dIso(y) });
  const lmStart = new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth() - 1, 1));
  const lmEnd = new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), 0));
  return [
    { label: "Últimos 30 días", ...back(30) },
    { label: "Mes anterior", from: dIso(lmStart), to: dIso(lmEnd) },
    { label: "3 meses", ...back(90) },
    { label: "6 meses", ...back(180) },
    { label: "12 meses", ...back(365) }
  ];
}

export default function GmbReportClient({ id }: { id: string }) {
  const ps = useMemo(presets, []);
  const [from, setFrom] = useState(ps[0].from);
  const [to, setTo] = useState(ps[0].to);
  const [mode, setMode] = useState<Mode>("real");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function load(f = from, t = to) {
    setLoading(true);
    setErr(null);
    fetch(`/api/v1/gmb/clients/${id}/report?from=${f}&to=${t}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("No se pudo cargar el informe"))))
      .then(setData)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      <style>{`@media print { .no-print { display:none !important; } body { background:#fff; } .sheet { box-shadow:none !important; border:0 !important; } .avoid-break { break-inside: avoid; } } @page { size: A4; margin: 12mm; }`}</style>

      <div className="no-print sticky top-0 z-10 bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-3 flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="block text-slate-500 mb-0.5">Desde</span>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs">
            <span className="block text-slate-500 mb-0.5">Hasta</span>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm" />
          </label>
          <select
            className="border rounded-md px-2 py-1.5 text-sm"
            value=""
            onChange={(e) => {
              const p = ps[Number(e.target.value)];
              if (p) {
                setFrom(p.from);
                setTo(p.to);
                load(p.from, p.to);
              }
            }}
          >
            <option value="">Periodos rápidos…</option>
            {ps.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
          <button onClick={() => load()} disabled={loading} className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm disabled:opacity-50">
            {loading ? "Generando…" : "Generar informe"}
          </button>
          <div className="inline-flex rounded-lg border p-0.5 text-sm ml-auto">
            {(["real", "cliente"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 rounded-md ${mode === m ? (m === "real" ? "bg-slate-900 text-white" : "bg-emerald-600 text-white") : "text-slate-600 hover:bg-slate-50"}`}
                title={m === "real" ? "Todos los datos, con subidas y bajadas" : "Para entregar al cliente: destaca lo positivo"}
              >
                {m === "real" ? "Real" : "Cliente"}
              </button>
            ))}
          </div>
          <button onClick={() => window.print()} disabled={!data} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-sm disabled:opacity-50">
            <Printer className="h-4 w-4" /> PDF
          </button>
        </div>
        {mode === "cliente" && (
          <div className="max-w-4xl mx-auto px-4 pb-2 text-[11px] text-emerald-700">
            Modo cliente: mismas cifras reales, pero sin comparativas negativas, con reseñas destacadas y próximos pasos en lugar de alertas.
          </div>
        )}
      </div>

      <div className="max-w-4xl mx-auto p-4 print:p-0">
        {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-3 mb-3">{err}</div>}
        {!data && !err && (
          <div className="p-8 text-sm text-slate-500 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Generando informe…
          </div>
        )}
        {data && <Report data={data} mode={mode} dim={loading} />}
      </div>
    </div>
  );
}

/* ───────────────────────────── Informe ───────────────────────────── */

function Report({ data, mode, dim }: { data: any; mode: Mode; dim: boolean }) {
  const real = mode === "real";
  const accent = data.branding?.color || "#2563eb";
  const perf = data.performance?.ok ? data.performance : null;
  const t = perf?.totals ?? {};
  const pt = perf?.prevTotals ?? {};
  const comparable = !!perf?.prevRange?.complete;
  const rv = data.reviews;
  const conv = perf && perf.views ? (perf.interactions / perf.views) * 100 : null;
  const prevConv = perf && perf.prevViews ? (perf.prevInteractions / perf.prevViews) * 100 : null;

  const kpis = perf
    ? [
        { icon: Eye, label: "Visualizaciones del perfil", now: perf.views, prev: perf.prevViews },
        { icon: Search, label: "Búsquedas que mostraron la ficha", now: perf.searches, prev: null },
        { icon: MousePointerClick, label: "Interacciones totales", now: perf.interactions, prev: perf.prevInteractions },
        { icon: Phone, label: "Llamadas", now: t.CALL_CLICKS ?? 0, prev: pt.CALL_CLICKS ?? 0 },
        { icon: Navigation, label: "Solicitudes de cómo llegar", now: t.BUSINESS_DIRECTION_REQUESTS ?? 0, prev: pt.BUSINESS_DIRECTION_REQUESTS ?? 0 },
        { icon: Globe, label: "Clics en el sitio web", now: t.WEBSITE_CLICKS ?? 0, prev: pt.WEBSITE_CLICKS ?? 0 },
        ...((t.BUSINESS_CONVERSATIONS ?? 0) + (pt.BUSINESS_CONVERSATIONS ?? 0) > 0
          ? [{ icon: MessageCircle, label: "Mensajes", now: t.BUSINESS_CONVERSATIONS ?? 0, prev: pt.BUSINESS_CONVERSATIONS ?? 0 }]
          : []),
        ...((t.BUSINESS_BOOKINGS ?? 0) + (pt.BUSINESS_BOOKINGS ?? 0) > 0
          ? [{ icon: CalendarCheck, label: "Reservas", now: t.BUSINESS_BOOKINGS ?? 0, prev: pt.BUSINESS_BOOKINGS ?? 0 }]
          : [])
      ]
    : [];

  const summary = buildSummary(data, mode, { conv, prevConv, comparable });
  const days = perf?.daily ?? [];

  return (
    <div className={`sheet bg-white rounded-xl border shadow-sm p-8 print:p-0 space-y-7 text-slate-800 ${dim ? "opacity-60" : ""}`}>
      {/* Cabecera */}
      <div className="flex items-start justify-between gap-4 pb-5 border-b-2" style={{ borderColor: accent }}>
        <div>
          <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: accent }}>
            Informe de Google Business Profile{real ? " · interno" : ""}
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">{data.client.name}</h1>
          <div className="text-sm text-slate-500">{[data.client.category, data.client.address].filter(Boolean).join(" · ")}</div>
          <div className="text-sm text-slate-700 mt-2">
            Periodo: <b>{longDate(data.period.from)}</b> – <b>{longDate(data.period.to)}</b> ({data.period.days} días)
          </div>
        </div>
        <div className="text-right shrink-0">
          {data.branding?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.branding.logoUrl} alt="" className="max-h-12 max-w-[160px] object-contain ml-auto mb-2" />
          ) : null}
          <div className="text-3xl font-bold flex items-center gap-1 justify-end" style={{ color: accent }}>
            {fmt(data.client.rating, 1)} <Star className="h-6 w-6" style={{ fill: accent, color: accent }} />
          </div>
          <div className="text-xs text-slate-500">{nf.format(data.client.reviewCount || rv.overall.total)} reseñas en Google</div>
        </div>
      </div>

      {/* Resumen */}
      <Section title={real ? "Resumen del periodo" : "Lo más destacado"}>
        <ul className="space-y-1.5 text-sm">
          {summary.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${s.tone === "bad" ? "bg-rose-500" : s.tone === "good" ? "bg-emerald-500" : "bg-slate-400"}`} />
              <span>{s.text}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* Rendimiento */}
      <Section title="Rendimiento en Google" icon={TrendingUp}>
        {!perf ? (
          <div className="text-sm text-slate-500">
            No se pudieron obtener los datos de rendimiento de Google{real && data.performance?.message ? `: ${data.performance.message}` : "."}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2.5">
              {kpis.map((k) => (
                <KpiCard key={k.label} {...k} mode={mode} comparable={comparable} accent={accent} />
              ))}
              {conv != null && (real || (prevConv != null && conv >= prevConv) || !comparable) && (
                <div className="rounded-lg border p-3 avoid-break">
                  <div className="text-[11px] text-slate-500">Tasa de interacción</div>
                  <div className="text-xl font-semibold tabular-nums">{fmt(conv, 1)}%</div>
                  <div className="text-[10px] text-slate-400">de cada 100 visitas, {fmt(conv, 0)} actúan</div>
                </div>
              )}
            </div>
            {comparable ? (
              <div className="text-[11px] text-slate-400">
                {real ? `Comparado con ${shortDate(data.period.prevFrom)} – ${shortDate(data.period.prevTo)}.` : ""}
                {perf.dataUntil && perf.dataUntil < data.period.to ? ` Google ha publicado datos hasta el ${shortDate(perf.dataUntil)}.` : ""}
              </div>
            ) : null}

            <div className="avoid-break">
              <div className="text-xs font-medium text-slate-600 mb-1">
                {real ? "Visualizaciones e interacciones por día" : "Crecimiento acumulado de visualizaciones e interacciones"}
              </div>
              {real ? <DailyBars days={days} accent={accent} /> : <Cumulative days={days} accent={accent} />}
            </div>

            <div className="grid grid-cols-2 gap-4 avoid-break">
              <div>
                <div className="text-xs font-medium text-slate-600 mb-1.5">Dónde te ven</div>
                {[
                  ["Búsqueda de Google · móvil", t.BUSINESS_IMPRESSIONS_MOBILE_SEARCH],
                  ["Búsqueda de Google · ordenador", t.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH],
                  ["Google Maps · móvil", t.BUSINESS_IMPRESSIONS_MOBILE_MAPS],
                  ["Google Maps · ordenador", t.BUSINESS_IMPRESSIONS_DESKTOP_MAPS]
                ].map(([label, v]: any) => {
                  const p = perf.views ? ((v ?? 0) / perf.views) * 100 : 0;
                  return (
                    <div key={label} className="text-[12px] mb-1.5">
                      <div className="flex justify-between">
                        <span>{label}</span>
                        <span className="tabular-nums text-slate-500">
                          {fmt(v)} · {fmt(p)}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-100">
                        <div className="h-1.5 rounded-full" style={{ width: `${p}%`, background: accent }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div>
                <div className="text-xs font-medium text-slate-600 mb-1.5">Búsquedas con las que te encontraron</div>
                {perf.keywords.length === 0 ? (
                  <div className="text-[12px] text-slate-400">Sin datos de búsquedas para este periodo.</div>
                ) : (
                  <table className="w-full text-[12px]">
                    <tbody>
                      {perf.keywords.slice(0, 10).map((k: any, i: number) => (
                        <tr key={k.keyword} className="border-b last:border-0">
                          <td className="py-0.5 text-slate-400 w-5 tabular-nums">{i + 1}</td>
                          <td className="py-0.5">{k.keyword}</td>
                          <td className="py-0.5 text-right tabular-nums text-slate-600">{k.impressions != null ? fmt(k.impressions) : `< ${k.threshold ?? 15}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* Reseñas */}
      <Section title="Reseñas" icon={Star}>
        <ReviewsBlock rv={rv} mode={mode} accent={accent} />
      </Section>

      {/* Publicaciones */}
      {(real || data.posts.count > 0) && (
        <Section title="Publicaciones en Google" icon={Megaphone}>
          <div className="text-sm mb-2">
            <b>{data.posts.count}</b> publicaciones en el periodo
            {real && data.posts.previous != null ? <span className="text-slate-500"> (periodo anterior: {data.posts.previous})</span> : null}.
          </div>
          {data.posts.list.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {data.posts.list.slice(0, 6).map((p: any, i: number) => (
                <div key={i} className="border rounded-lg p-2 flex gap-2 avoid-break">
                  {p.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image} alt="" className="h-14 w-14 object-cover rounded shrink-0" />
                  ) : null}
                  <div className="min-w-0">
                    <div className="text-[10px] text-slate-400">{p.date ? shortDate(p.date) : ""}</div>
                    <div className="text-[12px] line-clamp-3">{p.text}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Posicionamiento */}
      {data.ranking.length > 0 && (real || data.ranking.some((r: any) => (r.avgPosition && r.avgPosition <= 10) || (r.prevAvgPosition && r.avgPosition && r.avgPosition < r.prevAvgPosition))) && (
        <Section title="Posicionamiento en Google Maps" icon={MapPin}>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-slate-500 border-b">
                <th className="py-1 font-medium">Palabra clave</th>
                <th className="py-1 font-medium text-right">Posición media</th>
                <th className="py-1 font-medium text-right">Visibilidad</th>
                <th className="py-1 font-medium text-right">Top 3</th>
              </tr>
            </thead>
            <tbody>
              {data.ranking
                .filter((r: any) => real || (r.avgPosition && r.avgPosition <= 10) || (r.prevAvgPosition && r.avgPosition && r.avgPosition < r.prevAvgPosition))
                .map((r: any) => (
                  <tr key={r.keyword} className="border-b last:border-0">
                    <td className="py-1">{r.keyword}</td>
                    <td className="py-1 text-right tabular-nums">
                      {r.avgPosition ? fmt(r.avgPosition, 1) : "No aparece"}
                      {r.prevAvgPosition && r.avgPosition && (real || r.avgPosition < r.prevAvgPosition) ? (
                        <span className={`ml-1 text-[10px] ${r.avgPosition <= r.prevAvgPosition ? "text-emerald-600" : "text-rose-600"}`}>
                          (antes {fmt(r.prevAvgPosition, 1)})
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1 text-right tabular-nums">{r.visibility != null ? `${r.visibility}%` : "–"}</td>
                    <td className="py-1 text-right tabular-nums">{r.top3Share != null ? `${r.top3Share}%` : "–"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="text-[10px] text-slate-400 mt-1">Última medición de la rejilla de ranking registrada en el Hub para cada palabra clave.</div>
        </Section>
      )}

      {/* Cierre */}
      <Section title={real ? "Puntos de atención y recomendaciones" : "Próximos pasos"}>
        <ul className="space-y-1.5 text-sm">
          {buildNextSteps(data, mode, { conv, prevConv, comparable }).map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0" style={{ background: real ? "#f59e0b" : accent }} />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </Section>

      <div className="text-[10px] text-slate-400 text-center pt-4 border-t">
        Datos de Google Business Profile · Generado el {new Date(data.generatedAt).toLocaleString("es-ES")}
        {data.branding?.name ? ` · ${data.branding.name}` : ""}
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon?: any; children: React.ReactNode }) {
  return (
    <section className="avoid-break">
      <h2 className="text-sm font-semibold text-slate-900 mb-2.5 flex items-center gap-1.5">
        {Icon ? <Icon className="h-4 w-4 text-slate-400" /> : null}
        {title}
      </h2>
      {children}
    </section>
  );
}

function KpiCard({ icon: Icon, label, now, prev, mode, comparable, accent }: any) {
  const d = prev != null && comparable ? pct(now, prev) : undefined;
  const showDelta = d !== undefined && (mode === "real" || (d !== null && d > 0) || d === null);
  return (
    <div className="rounded-lg border p-3 avoid-break">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <Icon className="h-3.5 w-3.5" style={{ color: accent }} />
        {label}
      </div>
      <div className="flex items-baseline gap-2 mt-0.5">
        <div className="text-xl font-semibold tabular-nums">{fmt(now)}</div>
        {showDelta &&
          (d === null ? (
            <span className="text-[11px] font-medium text-emerald-600">nuevo</span>
          ) : (
            <span className={`text-[11px] font-medium ${d >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {d >= 0 ? "▲" : "▼"} {fmt(Math.abs(d), Math.abs(d) < 10 ? 1 : 0)}%
            </span>
          ))}
      </div>
      {mode === "real" && prev != null && comparable ? <div className="text-[10px] text-slate-400">antes: {fmt(prev)}</div> : null}
    </div>
  );
}

function DailyBars({ days, accent }: { days: any[]; accent: string }) {
  const pts = days.length > 62 ? weekly(days) : days;
  const W = 720, H = 140, b = 16;
  const maxV = Math.max(1, ...pts.map((p) => p.views));
  const maxI = Math.max(1, ...pts.map((p) => p.interactions));
  const bw = W / Math.max(1, pts.length);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${bw * i + bw / 2},${4 + (H - b - 4) * (1 - p.interactions / maxI)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {pts.map((p, i) => {
        const h = (H - b - 4) * (p.views / maxV);
        return <rect key={i} x={bw * i + bw * 0.12} y={H - b - h} width={Math.max(1, bw * 0.76)} height={h} rx={1.5} fill={accent} opacity={0.35} />;
      })}
      <path d={line} fill="none" stroke="#f59e0b" strokeWidth={1.75} />
      <text x={0} y={H - 3} fontSize="10" fill="#94a3b8">{pts[0] ? shortDate(pts[0].date) : ""}</text>
      <text x={W} y={H - 3} fontSize="10" fill="#94a3b8" textAnchor="end">{pts.length ? shortDate(pts[pts.length - 1].date) : ""}</text>
      <text x={W} y={10} fontSize="10" fill="#94a3b8" textAnchor="end">barras: visualizaciones · línea: interacciones</text>
    </svg>
  );
}

function Cumulative({ days, accent }: { days: any[]; accent: string }) {
  let v = 0, it = 0;
  const pts = days.map((d) => ({ date: d.date, v: (v += d.views), i: (it += d.interactions) }));
  const W = 720, H = 150, b = 16;
  const maxV = Math.max(1, v) * 1.02, maxI = Math.max(1, it) * 1.02;
  const x = (i: number) => (pts.length > 1 ? (W * i) / (pts.length - 1) : 0);
  const path = (k: "v" | "i", m: number) => pts.map((p, i) => `${i ? "L" : "M"}${x(i)},${4 + (H - b - 4) * (1 - p[k] / m)}`).join(" ");
  const area = `${path("v", maxV)} L${W},${H - b} L0,${H - b} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      <path d={area} fill={accent} opacity={0.12} />
      <path d={path("v", maxV)} fill="none" stroke={accent} strokeWidth={2} />
      <path d={path("i", maxI)} fill="none" stroke="#f59e0b" strokeWidth={2} />
      <text x={6} y={14} fontSize="11" fill={accent} fontWeight={600}>{fmt(v)} visualizaciones</text>
      <text x={6} y={28} fontSize="11" fill="#d97706" fontWeight={600}>{fmt(it)} interacciones</text>
      <text x={0} y={H - 3} fontSize="10" fill="#94a3b8">{pts[0] ? shortDate(pts[0].date) : ""}</text>
      <text x={W} y={H - 3} fontSize="10" fill="#94a3b8" textAnchor="end">{pts.length ? shortDate(pts[pts.length - 1].date) : ""}</text>
    </svg>
  );
}

function weekly(days: any[]) {
  const out: any[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const c = days.slice(i, i + 7);
    out.push({ date: c[0].date, views: c.reduce((s, d) => s + d.views, 0), interactions: c.reduce((s, d) => s + d.interactions, 0) });
  }
  return out;
}

function ReviewsBlock({ rv, mode, accent }: { rv: any; mode: Mode; accent: string }) {
  const real = mode === "real";
  const p = rv.period;
  const featured = (p.total ? rv.list.filter((r: any) => r.rating >= 4 && r.comment) : []).slice(0, 4);
  const showcase = featured.length ? featured : rv.bestOverall.slice(0, 3);
  const positiveShare = p.total ? Math.round((p.positive / p.total) * 100) : Math.round((rv.overall.positive / Math.max(1, rv.overall.total)) * 100);
  const maxM = Math.max(1, ...rv.monthly.map((m: any) => m.count));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2.5">
        <Mini label="Reseñas nuevas" value={fmt(p.total)} sub={real ? `antes: ${rv.previous.total}` : undefined} />
        {(real || (p.total && p.avg >= Math.min(4.5, rv.overall.avg))) ? (
          <Mini label="Valoración media del periodo" value={p.total ? `${fmt(p.avg, 1)}★` : "–"} sub={real && rv.previous.total ? `antes: ${fmt(rv.previous.avg, 1)}★` : undefined} />
        ) : null}
        <Mini label="Valoraciones positivas (4-5★)" value={`${positiveShare}%`} />
        {(real || p.responseRate >= 60) && <Mini label="Reseñas respondidas" value={p.total ? `${p.responseRate}%` : "–"} sub={real && p.unreplied ? `${p.unreplied} sin responder` : undefined} />}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {real ? (
          <div>
            <div className="text-xs font-medium text-slate-600 mb-1.5">Distribución del periodo</div>
            {[5, 4, 3, 2, 1].map((s) => {
              const n = p.distribution[s] ?? 0;
              const w = p.total ? (n / p.total) * 100 : 0;
              return (
                <div key={s} className="flex items-center gap-2 text-[11px] mb-1">
                  <span className="w-6 text-slate-500">{s}★</span>
                  <div className="flex-1 h-2.5 bg-slate-100 rounded">
                    <div className="h-full rounded" style={{ width: `${w}%`, background: s <= 2 ? "#f43f5e" : s === 3 ? "#f59e0b" : accent }} />
                  </div>
                  <span className="w-6 text-right text-slate-500">{n}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div>
            <div className="text-xs font-medium text-slate-600 mb-1.5">Reputación global</div>
            <div className="text-3xl font-bold" style={{ color: accent }}>{fmt(rv.overall.avg, 1)}★</div>
            <div className="text-[12px] text-slate-500">
              {nf.format(rv.overall.total)} opiniones · {Math.round((rv.overall.positive / Math.max(1, rv.overall.total)) * 100)}% positivas
            </div>
          </div>
        )}
        <div>
          <div className="text-xs font-medium text-slate-600 mb-1.5">Reseñas por mes (12 meses)</div>
          <div className="flex items-end gap-1 h-20">
            {rv.monthly.map((m: any) => (
              <div key={m.month} className="flex-1 flex flex-col items-center justify-end h-full">
                <div className="w-full rounded-t" style={{ height: `${(m.count / maxM) * 100}%`, minHeight: m.count ? 2 : 0, background: accent, opacity: 0.6 }} title={`${m.count}`} />
                <span className="text-[8px] text-slate-400 mt-0.5">{m.month.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-slate-600 mb-1.5">{real ? "Reseñas del periodo" : "Lo que dicen los clientes"}</div>
        <div className="space-y-2">
          {(real ? rv.list.slice(0, 20) : showcase).map((r: any, i: number) => (
            <div key={i} className={`border-b pb-2 text-[12px] avoid-break ${real && r.rating <= 2 ? "bg-rose-50/60 -mx-1 px-1 rounded" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{r.author}</span>
                <span className="text-slate-400">
                  <span style={{ color: "#f5b301" }}>{"★".repeat(r.rating)}</span>
                  {"☆".repeat(5 - r.rating)} · {r.time ? shortDate(r.time) : ""}
                </span>
              </div>
              {r.comment && <div className="text-slate-600 mt-0.5">{real ? r.comment : `“${r.comment}”`}</div>}
              {real && !r.reply ? <div className="text-[10px] text-amber-600 mt-0.5">Sin responder</div> : null}
            </div>
          ))}
          {real && rv.list.length === 0 && <div className="text-[12px] text-slate-400">No hubo reseñas nuevas en este periodo.</div>}
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-2.5 avoid-break">
      <div className="text-[10px] text-slate-500 leading-tight">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-[10px] text-slate-400">{sub}</div> : null}
    </div>
  );
}

/* ─────────────── Textos automáticos (resumen y próximos pasos) ─────────────── */

type Line = { text: string; tone: "good" | "bad" | "neutral" };

function buildSummary(data: any, mode: Mode, x: { conv: number | null; prevConv: number | null; comparable: boolean }): Line[] {
  const real = mode === "real";
  const perf = data.performance?.ok ? data.performance : null;
  const rv = data.reviews;
  const out: Line[] = [];
  const change = (label: string, now: number, prev: number, unit = "") => {
    if (!x.comparable) return;
    const d = pct(now, prev);
    if (d === null) {
      out.push({ text: `${label}: ${fmt(now)}${unit} (sin actividad en el periodo anterior).`, tone: "good" });
      return;
    }
    if (d > 0) out.push({ text: `${label} crecen un ${fmt(d, d < 10 ? 1 : 0)}%: ${fmt(now)}${unit} frente a ${fmt(prev)}.`, tone: "good" });
    else if (d < 0 && real) out.push({ text: `${label} bajan un ${fmt(-d, -d < 10 ? 1 : 0)}%: ${fmt(now)}${unit} frente a ${fmt(prev)}.`, tone: "bad" });
    else if (d === 0 && real) out.push({ text: `${label} se mantienen estables (${fmt(now)}${unit}).`, tone: "neutral" });
  };
  if (perf) {
    if (!real || !x.comparable) out.push({ text: `La ficha apareció ${fmt(perf.views)} veces en Google y generó ${fmt(perf.interactions)} acciones de clientes (llamadas, rutas, visitas a la web…).`, tone: "good" });
    change("Las visualizaciones", perf.views, perf.prevViews);
    change("Las interacciones", perf.interactions, perf.prevInteractions);
    change("Las llamadas", perf.totals.CALL_CLICKS ?? 0, perf.prevTotals.CALL_CLICKS ?? 0);
    change("Las solicitudes de cómo llegar", perf.totals.BUSINESS_DIRECTION_REQUESTS ?? 0, perf.prevTotals.BUSINESS_DIRECTION_REQUESTS ?? 0);
    change("Los clics a la web", perf.totals.WEBSITE_CLICKS ?? 0, perf.prevTotals.WEBSITE_CLICKS ?? 0);
    if (x.conv != null && x.prevConv != null && x.comparable && (real || x.conv > x.prevConv))
      out.push({ text: `Tasa de interacción del ${fmt(x.conv, 1)}% (antes ${fmt(x.prevConv, 1)}%): ${x.conv >= x.prevConv ? "cada visita convierte mejor" : "convierten menos visitas"}.`, tone: x.conv >= x.prevConv ? "good" : "bad" });
    if (perf.keywords[0]) out.push({ text: `La búsqueda que más clientes trae es «${perf.keywords[0].keyword}» (${perf.keywords[0].impressions != null ? fmt(perf.keywords[0].impressions) : "<15"} veces).`, tone: "good" });
  } else if (real) {
    out.push({ text: "No hay datos de rendimiento de Google para este periodo.", tone: "bad" });
  }
  const p = rv.period;
  if (p.total) {
    const showAvg = real || p.avg >= Math.min(4.5, rv.overall.avg);
    out.push({
      text: `${p.total} ${p.total === 1 ? "reseña nueva" : "reseñas nuevas"}${showAvg ? ` con una media de ${fmt(p.avg, 1)}★` : ""}${p.positive ? ` (${p.positive} de 4-5 estrellas)` : ""}.`,
      tone: p.avg >= 4 ? "good" : real ? "bad" : "neutral"
    });
  } else if (real) out.push({ text: "No llegaron reseñas nuevas en el periodo.", tone: "bad" });
  if (real && p.negative) out.push({ text: `${p.negative} ${p.negative === 1 ? "reseña negativa" : "reseñas negativas"} (1-2★) en el periodo.`, tone: "bad" });
  if (real && p.unreplied) out.push({ text: `${p.unreplied} ${p.unreplied === 1 ? "reseña del periodo sigue" : "reseñas del periodo siguen"} sin responder.`, tone: "bad" });
  if (!real && p.total && p.responseRate >= 60) out.push({ text: `Se ha respondido al ${p.responseRate}% de las reseñas: el negocio cuida a sus clientes.`, tone: "good" });
  if (data.posts.count) out.push({ text: `${data.posts.count} publicaciones en Google para mantener la ficha activa.`, tone: "good" });
  else if (real) out.push({ text: "No se publicó nada en la ficha durante el periodo.", tone: "bad" });
  if (!real && data.client.rating) out.push({ text: `Valoración global de ${fmt(data.client.rating, 1)}★ con ${nf.format(data.client.reviewCount)} opiniones.`, tone: "good" });
  return out.length ? out : [{ text: "Periodo sin actividad registrable.", tone: "neutral" }];
}

function buildNextSteps(data: any, mode: Mode, x: { conv: number | null; prevConv: number | null; comparable: boolean }): string[] {
  const perf = data.performance?.ok ? data.performance : null;
  const p = data.reviews.period;
  if (mode === "cliente") {
    const s = [
      "Seguir publicando novedades y ofertas en la ficha para mantener la visibilidad.",
      "Impulsar la captación de reseñas con el enlace y el código QR de valoración.",
      "Responder a todas las reseñas para reforzar la confianza de los nuevos clientes."
    ];
    if (perf?.keywords?.[1]) s.unshift(`Reforzar la presencia en búsquedas como «${perf.keywords[0].keyword}» y «${perf.keywords[1].keyword}».`);
    return s;
  }
  const s: string[] = [];
  if (perf && x.comparable) {
    const dv = pct(perf.views, perf.prevViews);
    const di = pct(perf.interactions, perf.prevInteractions);
    if (dv != null && dv < -10) s.push(`Caída de visibilidad del ${fmt(-dv)}%: revisar categorías, publicaciones y fotos; comprobar el ranking de la palabra clave principal.`);
    if (di != null && di < -10) s.push(`Las interacciones bajan un ${fmt(-di)}%: revisar horario, teléfono, web y botón de reserva.`);
    if (x.conv != null && x.prevConv != null && x.conv < x.prevConv) s.push("La tasa de interacción empeora: mejorar fotos, descripción y ofertas para convertir más visitas.");
  }
  if (p.unreplied) s.push(p.unreplied === 1 ? "Responder la reseña pendiente del periodo." : `Responder las ${p.unreplied} reseñas pendientes del periodo.`);
  if (p.negative) s.push(`Gestionar ${p.negative === 1 ? "la reseña negativa" : `las ${p.negative} reseñas negativas`} (respuesta y, si procede, revisión de posibles falsas).`);
  if (p.total < 3) s.push("Pocas reseñas nuevas: activar el enlace de reseñas con los clientes recientes.");
  if (!data.posts.count) s.push("Publicar al menos 1 novedad por semana en la ficha.");
  if (!perf) s.push("Revisar la conexión con Google: no se obtuvieron datos de rendimiento.");
  if (!s.length) s.push("Sin incidencias: mantener el ritmo de publicaciones y reseñas.");
  return s;
}
