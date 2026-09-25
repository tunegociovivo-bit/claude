/**
 * Informe del Detector de reseñas falsas. Componente puro (sin hooks): se usa dentro del
 * GMB Hub, en la vista imprimible interna y en el enlace público para el cliente.
 */
import type { AnalysisResults, Author } from "@/lib/gmb/fake-reviews/analyzer";
import { LEVEL_HIGH, LEVEL_MEDIUM } from "@/lib/gmb/fake-reviews/analyzer";
import type { Place } from "@/lib/gmb/fake-reviews/core";
import { POLICY_CATEGORIES } from "@/lib/gmb/fake-reviews/policy";

const INK = "#16160F";
const GOLD = "#C9962E";

function Stars({ n }: { n: number }) {
  const r = Math.round(n || 0);
  return (
    <span className="whitespace-nowrap tracking-tight" aria-label={`${r} estrellas`}>
      <span style={{ color: GOLD }}>{"★".repeat(r)}</span>
      <span className="text-slate-300">{"★".repeat(Math.max(0, 5 - r))}</span>
    </span>
  );
}

const num = (n: number | null | undefined, d = 1) => (n == null ? "—" : n.toFixed(d).replace(".", ","));
const fdate = (d?: string) => (d ? d.split("-").reverse().join("/") : "—");

const LEVEL_CLS: Record<string, string> = {
  alto: "bg-rose-50 text-rose-700 border-rose-200",
  medio: "bg-amber-50 text-amber-700 border-amber-200",
  bajo: "bg-emerald-50 text-emerald-700 border-emerald-200"
};

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg font-semibold text-slate-900 pb-2 mb-4 border-b-2" style={{ borderColor: GOLD }}>
      {children}
    </h2>
  );
}

export default function FakeReviewReport({
  results: res,
  agencyName = "Negocio Vivo",
  logoUrl
}: {
  results: AnalysisResults;
  agencyName?: string;
  logoUrl?: string | null;
}) {
  const st = res.stats;
  const suspects = res.authors.filter((a) => a.level !== "bajo");
  const comps = res.competitors;
  const onlyPolicy = res.mode === "policy";
  const pol = res.policy?.findings ?? [];
  const polStrong = pol.filter((f) => f.likelihood !== "baja").length;

  return (
    <div className="fr-report max-w-5xl mx-auto text-[14px] leading-relaxed text-slate-800">
      <header className="rounded-2xl p-8 relative overflow-hidden text-white" style={{ background: INK }}>
        <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full border-[28px] opacity-25" style={{ borderColor: GOLD }} />
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="max-h-10" />
        ) : (
          <div className="font-bold uppercase tracking-wider text-sm" style={{ color: "#D2A039" }}>{agencyName}</div>
        )}
        <p className="mt-6 mb-1 text-xs uppercase tracking-widest" style={{ color: "#D2A039" }}>
          Informe de reputación · Google Business Profile
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold leading-tight">{onlyPolicy ? "Revisión de reseñas negativas" : "Análisis de reseñas negativas sospechosas"}</h1>
        <p className="text-xl mt-1 mb-3 font-medium">{res.client.title}</p>
        <p className="text-xs text-[#CFC8B6]">
          Fecha: {fdate(res.generatedAt.slice(0, 10))} · Periodo: {res.params.dateFrom ? `desde ${fdate(res.params.dateFrom)}` : "todo el histórico"} ·
          Reseñas negativas: ≤ {res.params.negThreshold}★
        </p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3 my-6">
        <Kpi v={st.clientNeg} l="reseñas negativas analizadas" />
        {!onlyPolicy && <Kpi v={st.authorsCrossPos} l="perfiles que valoraron bien a la competencia" />}
        {!onlyPolicy && <Kpi v={st.high} l="perfiles de riesgo alto" cls="text-rose-700" />}
        {!onlyPolicy && <Kpi v={st.medium} l="perfiles de riesgo medio" cls="text-amber-700" />}
        {res.policy && <Kpi v={polStrong} l="reseñas que incumplen las políticas de Google" cls="text-rose-700" />}
        {!onlyPolicy && res.impact.client && (
          <div className="rounded-xl p-4 text-white col-span-2 md:col-span-1" style={{ background: INK }}>
            <div className="text-xl font-bold" style={{ color: "#D2A039" }}>
              {num(res.impact.client.current)}★ → {num(res.impact.client.without, 2)}★
            </div>
            <div className="text-xs text-[#CFC8B6]">nota sin reseñas sospechosas</div>
          </div>
        )}
      </section>

      <section className="my-8">
        <H2>Resumen ejecutivo</H2>
        {res.aiSummary && (
          <div className="border-l-4 pl-4 mb-4 space-y-3" style={{ borderColor: GOLD }}>
            {res.aiSummary.split(/\n\s*\n/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}
        <ul className="list-disc pl-5 space-y-1.5">
          {res.findings.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      </section>

      {res.policy && (
        <section className="my-8">
          <H2>Reseñas que incumplen las políticas de Google ({polStrong}{pol.length > polStrong ? ` + ${pol.length - polStrong} dudosas` : ""})</H2>
          <p className="text-[13px] mb-3">
            Se ha revisado el texto de {res.policy.checked} reseñas negativas {res.policy.aiUsed ? "con reglas automáticas e inteligencia artificial" : "con reglas automáticas"} frente a
            la política de contenido prohibido y restringido de Google Maps. Probabilidad de retirada: alta = infracción evidente, media = indicios razonables, baja = dudosa.
          </p>
          {!pol.length && <p className="text-sm text-slate-500">No se han encontrado reseñas con contenido prohibido.</p>}
          <div className="space-y-3">
            {pol.map((f, i) => (
              <article key={f.reviewId || i} className="rounded-xl border p-4 bg-white fr-avoid">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">
                    {f.authorLink ? <a href={f.authorLink} target="_blank" rel="noopener noreferrer" className="underline">{f.author || "Usuario de Google"}</a> : f.author || "Usuario de Google"}{" "}
                    <Stars n={f.rating} /> <span className="text-slate-500 text-xs">{fdate(f.date)}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${f.likelihood === "alta" ? LEVEL_CLS.alto : f.likelihood === "media" ? LEVEL_CLS.medio : "bg-slate-50 text-slate-600 border-slate-200"}`}>
                    retirada {f.likelihood}
                  </span>
                </div>
                <p className="text-[13px] my-2">«{f.text}»</p>
                <ul className="space-y-1">
                  {f.violations.map((v, j) => (
                    <li key={j} className="text-xs">
                      <b>{POLICY_CATEGORIES[v.category].label}</b>: «{v.evidence}» — {v.explanation}
                    </li>
                  ))}
                </ul>
                {f.link && <a href={f.link} target="_blank" rel="noopener noreferrer" className="text-xs underline">Abrir reseña</a>}
              </article>
            ))}
          </div>
        </section>
      )}

      {!onlyPolicy && (<>
      <section className="my-8">
        <H2>Fichas analizadas</H2>
        <div className="grid sm:grid-cols-2 gap-3">
          <PlaceCard p={res.client} role="Cliente" extra={`${st.clientNeg} negativas leídas`} />
          {comps.map((c, i) => (
            <PlaceCard
              key={i}
              p={c}
              role={res.discovery?.mode === "auto" ? `Competidor detectado ${i + 1}` : `Competidor ${i + 1}`}
              extra={`${st.compFetched[i] ?? 0} reseñas leídas${res.impact.competitors[i] ? ` · ${res.impact.competitors[i].removed} de perfiles sospechosos` : ""}`}
            />
          ))}
        </div>
      </section>

      {res.discovery && (res.discovery.candidates.length > 0 || res.discovery.mode === "auto") && (
        <section className="my-8">
          <H2>{res.discovery.mode === "auto" ? "Competencia detectada automáticamente" : "Otros negocios con autores en común"}</H2>
          <p className="text-[13px] mb-3">
            Negocios a los que al menos {res.discovery.minOverlap} de los perfiles que valoraron negativamente al cliente han dado una reseña
            positiva
            {res.discovery.method === "sweep"
              ? ` (barrido de ${res.discovery.sweptPlaces?.length ?? 0} negocios del mismo sector cercanos al cliente: ${(res.discovery.sweptPlaces ?? []).map((s) => s.title).join(", ")}).`
              : ` (se ha revisado el historial de ${res.discovery.profilesScanned} perfiles).`}
            {res.discovery.mode === "auto" && " Los marcados como «Analizado» se han tratado como competencia en este informe."}
          </p>
          {!res.discovery.candidates.length ? (
            <p className="text-sm text-slate-500">No se ha encontrado ningún negocio con suficientes perfiles en común.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px] border-collapse">
                <thead>
                  <tr className="text-left text-white text-xs" style={{ background: INK }}>
                    <th className="p-2 font-medium">Negocio</th>
                    <th className="p-2 font-medium text-center">Perfiles en común</th>
                    <th className="p-2 font-medium text-center">En ventana</th>
                    <th className="p-2 font-medium">Sector / distancia</th>
                    <th className="p-2 font-medium">Perfiles</th>
                  </tr>
                </thead>
                <tbody>
                  {res.discovery.candidates.slice(0, 15).map((c, i) => (
                    <tr key={i} className={`border-b align-top fr-avoid ${c.selected ? "bg-[#FFF9EC]" : ""}`}>
                      <td className="p-2">
                        <b>{c.title}</b>
                        {c.selected && <span className="ml-2 text-[10px] uppercase tracking-wider font-semibold" style={{ color: GOLD }}>Analizado</span>}
                        <div className="text-slate-500">{c.type}</div>
                      </td>
                      <td className="p-2 text-center font-semibold">{c.count}</td>
                      <td className="p-2 text-center">{c.fastCount}</td>
                      <td className="p-2">
                        {c.sameSector ? <span className="text-rose-700 font-medium">Mismo sector</span> : <span className="text-slate-500">Otro sector</span>}
                        {c.km != null && <div className="text-slate-500">{num(c.km)} km</div>}
                      </td>
                      <td className="p-2 text-slate-600">
                        {c.reviewers.slice(0, 6).map((r) => `${r.name || "Perfil"} (${r.rating}★${r.gapDays != null ? `, ${Math.round(r.gapDays)} d` : ""})`).join(" · ")}
                        {c.reviewers.length > 6 ? ` · +${c.reviewers.length - 6}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-slate-500 mt-2">
                «En ventana»: perfiles cuya positiva a ese negocio está a {res.params.windowDays} días o menos de su negativa al cliente. Entre
                paréntesis, estrellas dadas y días de diferencia.
              </p>
            </div>
          )}
        </section>
      )}

      {Object.keys(res.timeline).length > 0 && (
        <section className="my-8 fr-avoid">
          <H2>Evolución temporal</H2>
          <Chart tl={res.timeline} />
          <p className="text-xs text-slate-500 mt-2">
            Barras: reseñas negativas al cliente por mes (en rojo, las de perfiles de riesgo medio/alto). Línea dorada: valoraciones
            positivas que esos mismos perfiles dieron a la competencia.
          </p>
        </section>
      )}

      <section className="my-8">
        <H2>Perfiles sospechosos ({suspects.length})</H2>
        {!suspects.length && <p>No se han encontrado perfiles con riesgo medio o alto con los parámetros utilizados.</p>}
        <div className="space-y-4">
          {suspects.map((a, i) => (
            <AuthorCard key={a.cid || i} a={a} n={i + 1} comps={comps} />
          ))}
        </div>
      </section>

      {res.similar.length > 0 && (
        <section className="my-8">
          <H2>Reseñas con redacción casi idéntica</H2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-white text-xs" style={{ background: INK }}>
                <th className="p-2 font-medium">Perfil A</th>
                <th className="p-2 font-medium">Perfil B</th>
                <th className="p-2 font-medium text-center">Similitud</th>
              </tr>
            </thead>
            <tbody>
              {res.similar.map((p, i) => (
                <tr key={i} className="border-b align-top fr-avoid">
                  <td className="p-2"><b>{p.aName}</b><br />«{p.aText}»</td>
                  <td className="p-2"><b>{p.bName}</b><br />«{p.bText}»</td>
                  <td className="p-2 text-center">{Math.round(p.sim * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="my-8">
        <H2>Anexo · Todas las reseñas negativas analizadas</H2>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="text-left text-white text-xs" style={{ background: INK }}>
                <th className="p-2 font-medium">Perfil</th>
                <th className="p-2 font-medium">Reseña al cliente</th>
                <th className="p-2 font-medium">En la competencia</th>
                <th className="p-2 font-medium text-center">Riesgo</th>
              </tr>
            </thead>
            <tbody>
              {res.authors.map((a, i) => (
                <tr key={i} className="border-b align-top fr-avoid">
                  <td className="p-2">
                    {a.link ? <a href={a.link} target="_blank" rel="noopener noreferrer" className="underline">{a.name}</a> : a.name}
                    <div className="text-slate-500">{a.totalReviews} reseñas{a.localGuide ? " · Local Guide" : ""}</div>
                  </td>
                  <td className="p-2">
                    {a.clientReviews.map((r, j) => (
                      <div key={j}><Stars n={r.rating} /> <span className="text-slate-500">{fdate(r.date)}</span></div>
                    ))}
                  </td>
                  <td className="p-2">
                    {!a.compReviews.length && <span className="text-slate-400">—</span>}
                    {a.compReviews.map((c, j) => (
                      <div key={j}><Stars n={c.rating} /> <span className="text-slate-500">{comps[c.comp ?? 0]?.title} · {fdate(c.date)}</span></div>
                    ))}
                  </td>
                  <td className="p-2 text-center">
                    <span className={`inline-block min-w-9 px-2 py-0.5 rounded-full border text-xs font-semibold ${LEVEL_CLS[a.level]}`}>{a.score}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      </>)}

      <section className="my-8 text-[13px]">
        <H2>Metodología y próximos pasos</H2>
        <h3 className="font-semibold mt-3 mb-1">Cómo se ha hecho el análisis</h3>
        <p>
          Se han leído las reseñas públicas de Google Maps de la ficha del cliente con valoración igual o inferior a {res.params.negThreshold}★ y
          {res.discovery?.mode === "auto"
            ? "se han identificado automáticamente los negocios a los que varios de sus autores han valorado positivamente"
            : `las reseñas de ${comps.length} competidor(es)`}. Para cada autor de una reseña negativa se ha comprobado si también ha reseñado a la
          competencia{res.params.deep ? " y se ha revisado su historial público (hasta 200 reseñas por perfil)" : ""}. Cada perfil recibe una
          puntuación de 0 a 100 a partir de señales objetivas:
        </p>
        <table className="w-full my-3 border-collapse">
          <tbody>
            {[
              [`Valoración positiva (≥ ${res.params.posThreshold}★) a un competidor`, "+40"],
              ["Positiva a varios competidores", "+10"],
              [`Negativa al cliente y positiva al competidor en < 48 h / dentro de ${res.params.windowDays} días`, "+15 / +8"],
              ["Perfil con ≤ 3 reseñas / ≤ 10 reseñas en total", "+12 / +6"],
              ["Cuenta que empezó a reseñar justo antes de la negativa", "+8"],
              ["Negativas a otros negocios del mismo sector · Texto casi idéntico a otra negativa", "+10"],
              ["Varias negativas del mismo perfil · Sólo valoraciones extremas · Ráfaga de reseñas el mismo día", "+6"],
              ["Reseña sin texto · Actividad habitual lejos del negocio", "+4 / +3"],
              ["Local Guide consolidado o perfil muy activo · Reseña con fotos propias", "−12 / −8 / −4"]
            ].map(([k, v]) => (
              <tr key={k} className="border-b">
                <td className="py-1.5 pr-2">{k}</td>
                <td className="py-1.5 text-center whitespace-nowrap font-medium">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <b>Riesgo alto</b>: ≥ {LEVEL_HIGH} puntos · <b>Riesgo medio</b>: {LEVEL_MEDIUM}–{LEVEL_HIGH - 1} · <b>Bajo</b>: &lt; {LEVEL_MEDIUM}.
        </p>
        <h3 className="font-semibold mt-4 mb-1">Próximos pasos recomendados</h3>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Denunciar cada reseña de riesgo alto y medio desde el Perfil de Empresa («Denunciar reseña» → contenido falso / conflicto de intereses), citando la evidencia de este informe.</li>
          <li>Hacer seguimiento de cada denuncia en la herramienta de gestión de reseñas de Google y solicitar revisión si se rechaza.</li>
          <li>Responder públicamente a las reseñas de forma neutra y profesional, sin acusar a terceros.</li>
          <li>Repetir este análisis mensualmente para documentar si el patrón continúa.</li>
          <li>Si el patrón es persistente y el perjuicio relevante, valorarlo con un abogado: las reseñas falsas están prohibidas por las políticas de Google y por la normativa europea de protección del consumidor (Directiva Ómnibus 2019/2161).</li>
        </ol>
        <h3 className="font-semibold mt-4 mb-1">Limitaciones</h3>
        <p className="text-slate-500 text-xs">
          Este informe se basa exclusivamente en información pública de Google Maps. Las señales indican <b>indicios estadísticos</b> y
          patrones compatibles con reseñas no auténticas, pero no prueban por sí mismas la falsedad de una reseña ni la autoría de terceros. Un
          cliente real puede haber visitado varios negocios del mismo sector. Los perfiles privados, eliminados o anónimos no pueden cruzarse.
          Las fechas relativas de Google («hace 3 meses») son aproximadas.
          {res.warnings?.length ? ` Incidencias del análisis: ${res.warnings.slice(0, 5).join(" ")}` : ""}
        </p>
        <p className="text-slate-500 text-xs mt-2">
          Tratamiento de datos: se usan únicamente datos publicados voluntariamente por sus autores en Google Maps, con la finalidad legítima de
          defensa de la reputación del cliente. No difunda este informe fuera de la relación cliente–agencia.
        </p>
      </section>
      <footer className="text-center text-xs text-slate-400 border-t pt-3 mt-8">{agencyName} · Informe generado con GMB Hub</footer>
    </div>
  );
}

function Kpi({ v, l, cls = "" }: { v: number; l: string; cls?: string }) {
  return (
    <div className="rounded-xl border p-4 bg-[#F7F2E7] border-[#E6DFCF]">
      <div className={`text-2xl font-bold ${cls}`}>{v}</div>
      <div className="text-xs text-slate-500">{l}</div>
    </div>
  );
}

function PlaceCard({ p, role, extra }: { p: Place; role: string; extra: string }) {
  return (
    <div className="rounded-xl border p-4 bg-white">
      <div className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: GOLD }}>{role}</div>
      <a href={p.mapsUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">{p.title}</a>
      <div className="text-xs text-slate-500">{p.address}{p.type ? ` · ${p.type}` : ""}</div>
      <div className="mt-1">
        {p.rating != null && (<><b>{num(p.rating)}</b> <Stars n={p.rating} /> · </>)}
        {p.reviews != null && `${p.reviews} reseñas`}
      </div>
      <div className="text-xs text-slate-500 mt-1">{extra}</div>
    </div>
  );
}

function AuthorCard({ a, n, comps }: { a: Author; n: number; comps: Place[] }) {
  return (
    <article className="rounded-2xl border p-5 bg-white fr-avoid">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="font-bold" style={{ color: GOLD }}>#{n}</span>
          {a.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.thumbnail} alt="" referrerPolicy="no-referrer" className="w-11 h-11 rounded-full object-cover" />
          )}
          <div>
            <div className="font-semibold">{a.name}</div>
            <div className="text-xs text-slate-500">
              {a.totalReviews} reseñas en total{a.localGuide ? " · Local Guide" : ""}
              {a.link && (
                <> · <a href={a.link} target="_blank" rel="noopener noreferrer" className="underline">Ver perfil en Google Maps</a></>
              )}
            </div>
          </div>
        </div>
        <div className={`rounded-xl border px-4 py-2 text-center min-w-24 ${LEVEL_CLS[a.level]}`}>
          <div className="text-2xl font-bold leading-none">{a.score}</div>
          <div className="text-[10px] uppercase tracking-wider">riesgo {a.level}</div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3 my-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Reseña al cliente</div>
          {a.clientReviews.map((r, i) => (
            <Rev key={i} border="border-rose-500" r={r} />
          ))}
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Reseñas a la competencia</div>
          {!a.compReviews.length && <p className="text-xs text-slate-500">No se han encontrado reseñas de este perfil en la competencia analizada.</p>}
          {a.compReviews.map((r, i) => (
            <Rev key={i} border={r.rating >= 4 ? "border-[#C9962E]" : "border-slate-300"} r={r} title={comps[r.comp ?? 0]?.title} />
          ))}
        </div>
      </div>

      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Señales detectadas</div>
      <ul className="space-y-1 text-[13px]">
        {a.signals.map((s, i) => (
          <li key={i}>
            <span className={`inline-block w-10 text-center rounded-md text-xs font-semibold mr-2 ${s.points < 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
              {s.points > 0 ? "+" : ""}{s.points}
            </span>
            {s.label}
            {s.detail && <span className="text-slate-500"> ({s.detail})</span>}
          </li>
        ))}
      </ul>
      {a.profile && (
        <p className="text-xs text-slate-500 mt-2">
          Historial revisado: {a.profile.fetched} reseñas · media {num(a.profile.avgRating)}★ · {Math.round((a.profile.extremePct ?? 0) * 100)}% extremas
          {a.profile.first ? ` · primera reseña ${fdate(a.profile.first)}` : ""}
          {a.profile.medianKm != null ? ` · distancia mediana ${Math.round(a.profile.medianKm)} km` : ""}
          {a.profile.sectorNeg.length > 0 &&
            ` · otras negativas en el sector: ${a.profile.sectorNeg.slice(0, 5).map((x) => `${x.title} (${x.rating}★)`).join(" · ")}`}
        </p>
      )}
    </article>
  );
}

function Rev({ r, border, title }: { r: Author["clientReviews"][number]; border: string; title?: string }) {
  return (
    <div className={`rounded-lg bg-[#F7F2E7] border-l-4 ${border} px-3 py-2 mb-2`}>
      <div className="text-[13px]">
        <Stars n={r.rating} /> {title && <b>{title}</b>} <span className="text-slate-500">{fdate(r.date)}</span>
      </div>
      <p className="text-[13px] my-1">{r.text ? r.text : <i className="text-slate-400">Sin texto</i>}</p>
      {r.link && (
        <a href={r.link} target="_blank" rel="noopener noreferrer" className="text-xs underline">Abrir reseña</a>
      )}
    </div>
  );
}

function Chart({ tl }: { tl: AnalysisResults["timeline"] }) {
  const entries = Object.entries(tl);
  const w = 760, h = 220, pl = 30, pb = 34, pt = 12;
  const max = Math.max(1, ...entries.map(([, m]) => Math.max(m.neg, m.compPos)));
  const bw = (w - pl - 10) / Math.max(1, entries.length);
  const y = (v: number) => h - pb - ((h - pb - pt) * v) / max;
  const every = Math.max(1, Math.ceil(entries.length / 12));
  const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const pts = entries.map(([, m], i) => `${(pl + i * bw + bw / 2).toFixed(1)},${y(m.compPos).toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label="Evolución mensual">
        {[0, 0.5, 1].map((g) => (
          <g key={g}>
            <line x1={pl} x2={w - 10} y1={y(max * g)} y2={y(max * g)} stroke="#E6DFCF" />
            <text x={pl - 6} y={y(max * g) + 4} fontSize="10" fill="#6B665A" textAnchor="end">{Math.round(max * g)}</text>
          </g>
        ))}
        {entries.map(([month, m], i) => {
          const x = pl + i * bw + bw * 0.15;
          const bwi = bw * 0.7;
          const [yy, mm] = month.split("-");
          return (
            <g key={month}>
              <rect x={x} y={y(m.neg)} width={bwi} height={y(0) - y(m.neg)} fill="#D9D3C3"><title>{`${month}: ${m.neg} negativas`}</title></rect>
              {m.suspect > 0 && <rect x={x} y={y(m.suspect)} width={bwi} height={y(0) - y(m.suspect)} fill="#B3261E"><title>{`${month}: ${m.suspect} sospechosas`}</title></rect>}
              {i % every === 0 && (
                <text x={x + bwi / 2} y={h - 12} fontSize="10" fill="#6B665A" textAnchor="middle">{`${MONTHS[Number(mm) - 1]} ${yy.slice(2)}`}</text>
              )}
            </g>
          );
        })}
        <polyline points={pts} fill="none" stroke={GOLD} strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
      <div className="flex flex-wrap gap-4 text-xs text-slate-500 mt-1">
        <span><i className="inline-block w-3 h-3 rounded-sm align-[-1px] mr-1.5 bg-[#D9D3C3]" />Negativas al cliente</span>
        <span><i className="inline-block w-3 h-3 rounded-sm align-[-1px] mr-1.5 bg-[#B3261E]" />De perfiles sospechosos</span>
        <span><i className="inline-block w-3 h-[3px] align-[3px] mr-1.5" style={{ background: GOLD }} />Positivas de esos perfiles a la competencia</span>
      </div>
    </div>
  );
}
