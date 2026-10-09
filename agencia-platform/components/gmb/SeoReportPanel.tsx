"use client";

/**
 * Pestaña SEO de la ficha: informe competitivo frente a los mejor posicionados por la palabra
 * clave principal (reseñas, nota, ritmo de reseñas, web, citaciones, menciones/enlaces, fotos…),
 * brechas, plan de acción y descarga en PDF. Debajo, la revisión básica de la ficha.
 */
import { useEffect, useState } from "react";
import { Check, Download, Loader2, Search, Sparkles, X } from "lucide-react";

const n = (v: number | null | undefined, d = 0) => (v == null ? "–" : new Intl.NumberFormat("es-ES", { maximumFractionDigits: d }).format(v));

function Yn({ v }: { v: boolean | null | undefined }) {
  if (v == null) return <span className="text-slate-300">–</span>;
  return v ? <Check className="h-3.5 w-3.5 text-emerald-600 inline" /> : <X className="h-3.5 w-3.5 text-rose-500 inline" />;
}

function ScoreCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  const tone = value >= 75 ? "text-emerald-600" : value >= 50 ? "text-amber-600" : "text-rose-600";
  return (
    <div className="bg-white rounded-lg border p-2.5" title={hint}>
      <div className="text-[10px] text-slate-500 leading-tight">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

export default function SeoReportPanel({ id }: { id: string }) {
  const [report, setReport] = useState<any>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [kw, setKw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [audit, setAudit] = useState<any>(null);
  const [showBasic, setShowBasic] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/v1/gmb/clients/${id}/seo-report`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/v1/gmb/clients/${id}/seo-audit`).then((r) => (r.ok ? r.json() : null))
    ])
      .then(([rep, au]) => {
        if (rep?.report) {
          setReport(rep.report);
          setReportId(rep.reportId);
          setKw(rep.report.keyword ?? "");
        }
        setHistory(rep?.history ?? []);
        setAudit(au?.audit ?? null);
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function generate() {
    setRunning(true);
    setErr(null);
    try {
      const r = await fetch(`/api/v1/gmb/clients/${id}/seo-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: kw.trim() || undefined })
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) throw new Error(d.message || d?.error?.message || "No se pudo generar el informe");
      setReport(d.report);
      setReportId(d.reportId);
      setKw(d.report.keyword);
      setHistory((h) => [{ id: d.reportId, keyword: d.report.keyword, createdAt: d.report.generatedAt, position: d.report.yourPosition, score: d.report.scores.total }, ...h].slice(0, 6));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRunning(false);
    }
  }

  if (loading)
    return (
      <div className="p-6 text-sm text-slate-500 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    );

  const rows = report ? [...report.competitors, report.you].sort((a: any, b: any) => (a.position ?? 999) - (b.position ?? 999)) : [];
  const dirCount = new Map<string, number>();
  if (report) for (const c of report.competitors.slice(0, 5)) for (const d of c.directories ?? []) dirCount.set(d, (dirCount.get(d) ?? 0) + 1);
  const mine = new Set<string>(report?.you?.directories ?? []);

  return (
    <div className="p-4 space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          generate();
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <label className="flex-1 min-w-[200px]">
          <span className="block text-[10px] text-slate-500 mb-0.5">Palabra clave principal (como la buscaría un cliente)</span>
          <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="Por defecto: palabra clave de la ficha + ciudad" className="w-full border rounded-md px-2 py-1.5 text-[13px]" />
        </label>
        <button type="submit" disabled={running} className="inline-flex items-center gap-1.5 text-[13px] bg-slate-900 text-white rounded-md px-3 py-1.5 disabled:opacity-50">
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          {running ? "Analizando competencia… (1-2 min)" : report ? "Actualizar informe" : "Generar informe SEO completo"}
        </button>
        {report && reportId && (
          <a href={`/api/v1/gmb/clients/${id}/seo-report/pdf?reportId=${reportId}`} className="inline-flex items-center gap-1.5 text-[13px] border bg-white rounded-md px-3 py-1.5 hover:bg-slate-50">
            <Download className="h-3.5 w-3.5" /> PDF
          </a>
        )}
      </form>
      {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-3">{err}</div>}

      {!report && !running && (
        <div className="text-[13px] text-slate-600 bg-white border rounded-lg p-3">
          Compara la ficha con los negocios que Google Maps muestra por encima para su palabra clave: reseñas, nota, ritmo de reseñas, fotos, categorías, web
          (título, H1, schema, NAP), citaciones en directorios y webs que les mencionan o enlazan. Te dice qué les hace estar arriba y qué hay que hacer para
          superarles.
        </div>
      )}

      {report && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className={`rounded-lg border px-3 py-2 ${report.yourPosition && report.yourPosition <= 3 ? "bg-emerald-50 border-emerald-200" : report.yourPosition && report.yourPosition <= 10 ? "bg-amber-50 border-amber-200" : "bg-rose-50 border-rose-200"}`}>
              <div className="text-[10px] text-slate-500">Posición para «{report.keyword}»</div>
              <div className="text-xl font-bold">{report.yourPosition ? `#${report.yourPosition}` : `No aparece (top ${report.totalResults})`}</div>
            </div>
            <div className="grid grid-cols-4 gap-2 flex-1 min-w-[300px]">
              <ScoreCard label="SEO local" value={report.scores.total} hint="Media ponderada frente al top 3" />
              <ScoreCard label="Relevancia" value={report.scores.relevance} hint="Categorías, palabra clave en nombre y web" />
              <ScoreCard label="Prominencia" value={report.scores.prominence} hint="Reseñas, nota, ritmo, menciones y enlaces" />
              <ScoreCard label="Calidad" value={report.scores.quality} hint="Fotos, web, horario, descripción, publicaciones" />
            </div>
          </div>
          <div className="text-[11px] text-slate-400">
            Generado el {new Date(report.generatedAt).toLocaleString("es-ES")} · búsqueda desde {report.origin} · ranking {report.sources.ranking === "serpapi" ? "real de Google Maps (SerpApi)" : "de Google Places"}
            {report.sources.search ? ` · menciones vía ${report.sources.search}` : ""}
          </div>

          {report.aiSummary && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-[13px] text-indigo-950">
              <div className="flex items-center gap-1 text-[11px] font-semibold text-indigo-700 mb-1">
                <Sparkles className="h-3.5 w-3.5" /> Diagnóstico
              </div>
              {report.aiSummary}
            </div>
          )}

          <div className="bg-white rounded-lg border overflow-x-auto">
            <table className="w-full text-[12px] min-w-[720px]">
              <thead>
                <tr className="text-left text-slate-500 border-b bg-slate-50">
                  <th className="p-2 font-medium">Pos.</th>
                  <th className="p-2 font-medium">Negocio</th>
                  <th className="p-2 font-medium text-right">Nota</th>
                  <th className="p-2 font-medium text-right">Reseñas</th>
                  <th className="p-2 font-medium text-right" title="Reseñas nuevas al mes (estimación con las más recientes)">Res./mes</th>
                  <th className="p-2 font-medium text-right" title="Google Places devuelve como mucho 10 fotos de cada negocio">Fotos</th>
                  <th className="p-2 font-medium text-center">Web</th>
                  <th className="p-2 font-medium text-center" title="Palabra clave en el nombre de la ficha">KW nombre</th>
                  <th className="p-2 font-medium text-center" title="Palabra clave en el título de la web">KW web</th>
                  <th className="p-2 font-medium text-center" title="Datos estructurados LocalBusiness en la web">Schema</th>
                  <th className="p-2 font-medium text-right" title="Webs distintas que mencionan el negocio (citaciones)">Menciones</th>
                  <th className="p-2 font-medium text-right" title="Webs que mencionan o enlazan su dominio">Enlaces</th>
                  <th className="p-2 font-medium text-right">Km</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c: any, i: number) => (
                  <tr key={i} className={`border-b last:border-0 ${c.isYou ? "bg-indigo-50 font-medium" : ""}`}>
                    <td className="p-2 tabular-nums">{c.position ?? "–"}</td>
                    <td className="p-2 max-w-[200px]">
                      <div className="truncate">
                        {c.name}
                        {c.isYou ? <span className="ml-1 text-[10px] text-indigo-700">TÚ</span> : null}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">{c.category}</div>
                    </td>
                    <td className="p-2 text-right tabular-nums">{n(c.rating, 1)}</td>
                    <td className="p-2 text-right tabular-nums">{n(c.reviews)}</td>
                    <td className="p-2 text-right tabular-nums">{n(c.reviewsPerMonth, 1)}</td>
                    <td className="p-2 text-right tabular-nums">{c.photos == null ? "–" : c.photos >= 10 && !c.isYou ? "10+" : n(c.photos)}</td>
                    <td className="p-2 text-center">
                      {c.website ? (
                        <a href={c.website} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                          ver
                        </a>
                      ) : (
                        <Yn v={false} />
                      )}
                    </td>
                    <td className="p-2 text-center"><Yn v={c.keywordInName} /></td>
                    <td className="p-2 text-center"><Yn v={c.web ? c.web.keywordInTitle : null} /></td>
                    <td className="p-2 text-center"><Yn v={c.web ? c.web.localBusinessSchema : null} /></td>
                    <td className="p-2 text-right tabular-nums">{n(c.mentions)}</td>
                    <td className="p-2 text-right tabular-nums">{n(c.domainMentions)}</td>
                    <td className="p-2 text-right tabular-nums">{n(c.distanceKm, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[11px] text-slate-500">
            Media del top 3: nota {n(report.top3.rating, 1)} · {n(report.top3.reviews)} reseñas · {n(report.top3.reviewsPerMonth, 1)} reseñas/mes · {n(report.top3.mentions, 1)} webs que les mencionan ·{" "}
            {report.top3.keywordInName} de 3 con la palabra clave en el nombre.
          </div>

          {dirCount.size > 0 && (
            <div className="bg-white rounded-lg border p-3">
              <div className="text-xs font-semibold text-slate-700 mb-1.5">Directorios donde aparece la competencia (de los 5 primeros)</div>
              <div className="flex flex-wrap gap-1.5">
                {[...dirCount.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([d, k]) => (
                    <span key={d} className={`text-[11px] px-2 py-0.5 rounded-full border ${mine.has(d) ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"}`}>
                      {d} · {k} {mine.has(d) ? "✓" : "· falta"}
                    </span>
                  ))}
              </div>
            </div>
          )}

          {report.gaps.length > 0 && (
            <div className="bg-white rounded-lg border p-3">
              <div className="text-xs font-semibold text-slate-700 mb-1.5">Brechas frente al top 3</div>
              <table className="w-full text-[12px]">
                <tbody>
                  {report.gaps.map((g: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-2 text-slate-400 whitespace-nowrap">{g.area}</td>
                      <td className="py-1 pr-2">{g.label}</td>
                      <td className="py-1 pr-2 text-right whitespace-nowrap">
                        tú <b>{g.you}</b>
                      </td>
                      <td className="py-1 pr-2 text-right whitespace-nowrap text-slate-500">top 3: {g.top3}</td>
                      <td className={`py-1 text-right text-[11px] ${g.severity === "alta" ? "text-rose-600" : g.severity === "media" ? "text-amber-600" : "text-slate-500"}`}>{g.severity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <div className="text-xs font-semibold text-amber-900 mb-2">Qué hacer para subir posiciones</div>
            <ol className="space-y-2">
              {report.actions.map((a: any) => (
                <li key={a.priority} className="text-[12px] text-amber-950">
                  <div>
                    <b>{a.priority}.</b>{" "}
                    <span className={`text-[10px] font-semibold uppercase mr-1 ${a.impact === "alto" ? "text-rose-700" : a.impact === "medio" ? "text-amber-700" : "text-emerald-700"}`}>
                      {a.area} · impacto {a.impact}
                    </span>
                    {a.action}
                  </div>
                  <div className="text-[11px] text-amber-800/80 ml-3">{a.why}</div>
                </li>
              ))}
            </ol>
          </div>

          <div className="text-[11px] text-slate-500">
            Tu ficha: {n(report.own.photos)} fotos · {n(report.own.postsLast30)} publicaciones en 30 días · descripción de {n(report.own.descriptionLength)} caracteres ·{" "}
            {n(report.own.additionalCategories)} categorías secundarias · {report.own.citations.total} citaciones registradas ({report.own.citations.inconsistent} inconsistentes).
          </div>
          {report.warnings?.length > 0 && <div className="text-[11px] text-amber-700">{report.warnings.join(" ")}</div>}

          {history.length > 1 && (
            <div className="text-[11px] text-slate-500">
              Evolución:{" "}
              {history
                .slice()
                .reverse()
                .map((h) => `${new Date(h.createdAt).toLocaleDateString("es-ES")} → ${h.position ? `#${h.position}` : "fuera"} (${h.score ?? "–"})`)
                .join(" · ")}
            </div>
          )}
        </>
      )}

      {audit && (
        <div className="border-t pt-3">
          <button onClick={() => setShowBasic(!showBasic)} className="text-[12px] text-slate-600 hover:text-slate-900">
            {showBasic ? "▾" : "▸"} Revisión básica de la ficha ({audit.score}/100)
          </button>
          {showBasic && (
            <div className="mt-2 space-y-1">
              {audit.checks.map((c: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-[12px]">
                  {c.ok ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <X className="h-3.5 w-3.5 text-rose-500" />}
                  <span className={c.ok ? "text-slate-600" : "text-slate-900"}>{c.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
