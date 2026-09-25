/**
 * Detector de reseñas falsas — ejecución por pasos y resolución de fichas.
 *
 * Fases: client → comp → deep → analyze → ai → done. Cada llamada trabaja un presupuesto de
 * tiempo (~20 s) y guarda el estado en GmbFakeReviewAnalysis.state, así que avanza tanto desde
 * la UI (polling) como desde el gmbTick del scheduler si se cierra la pestaña. Un lock
 * optimista (lockedUntil) evita que ambos trabajen a la vez.
 */
import { prisma } from "@/lib/db/prisma";
import { complete } from "@/lib/ai/anthropic";
import { SerpApiClient, getSerpApiKey, SerpApiKeyMissingError } from "@/lib/integrations/serpapi";
import {
  DAY,
  idParam,
  nextToken,
  normalizeContributor,
  normalizeReview,
  parsePlaceInput,
  placeFrom,
  type AnalysisParams,
  type Place,
  type Review
} from "./core";
import {
  attachCompHits,
  discoverBeneficiaries,
  discoveryFindings,
  positivesElsewhere,
  profileFeatures,
  runAnalysis,
  type AnalysisResults,
  type Discovery,
  type PositiveElsewhere,
  type ProfileFeatures
} from "./analyzer";

export type JobState = {
  phase: "client" | "comp" | "deep" | "discover" | "compinfo" | "analyze" | "ai" | "done";
  client: { token: string; pages: number; reviews: Review[] };
  compI: number;
  comps: { token: string; pages: number; reviews: Review[] }[];
  queue: string[] | null;
  deepI: number;
  profiles: Record<string, ProfileFeatures>;
  /** Positivas de cada autor a otros negocios (para el descubrimiento de beneficiados). */
  positives?: Record<string, PositiveElsewhere[]>;
  discovery?: Discovery | null;
  /** Modo auto: competidores descubiertos. */
  autoComps?: Place[] | null;
  infoI?: number;
  warnings: string[];
  resultsTmp?: AnalysisResults | null;
};

const isAuto = (p: AnalysisParams) => p.mode === "auto";
/** Competidores efectivos: los indicados (manual) o los descubiertos (auto). */
export function effectiveComps(p: AnalysisParams, s: JobState): Place[] {
  return isAuto(p) ? s.autoComps ?? [] : p.competitors;
}

export function initState(params: AnalysisParams): JobState {
  return {
    phase: "client",
    client: { token: "", pages: 0, reviews: [] },
    compI: 0,
    comps: params.competitors.map(() => ({ token: "", pages: 0, reviews: [] })),
    queue: null,
    deepI: 0,
    profiles: {},
    positives: {},
    discovery: null,
    autoComps: null,
    infoI: 0,
    warnings: []
  };
}

type Deps = { api: SerpApiClient; summarize?: (r: AnalysisResults) => Promise<string> };

/** Una unidad de trabajo (normalmente 1 llamada a SerpApi). Muta `state`. */
export async function tick(params: AnalysisParams, state: JobState, deps: Deps): Promise<AnalysisResults | null> {
  const negTh = params.negThreshold;
  const fromTs = params.dateFrom ? Math.floor(Date.parse(params.dateFrom) / 1000) : 0;

  switch (state.phase) {
    case "client": {
      const c = state.client;
      const data = await deps.api.reviews(idParam(params.client), "ratingLow", c.token);
      c.pages++;
      let stop = false;
      const seen = new Set(c.reviews.map((r) => r.reviewId));
      for (const raw of data.reviews ?? []) {
        const r = normalizeReview(raw);
        if (r.rating > negTh) {
          stop = true; // ordenadas de peor a mejor: ya no quedan negativas
          continue;
        }
        if (fromTs && r.ts && r.ts < fromTs) continue;
        if (seen.has(r.reviewId)) continue;
        c.reviews.push(r);
      }
      c.token = nextToken(data);
      if (stop || !c.token || c.pages >= params.maxClientPages) {
        if (!stop && c.token) state.warnings.push("Se alcanzó el límite de páginas del cliente; puede haber más reseñas negativas sin analizar.");
        state.phase = isAuto(params) ? "deep" : "comp";
      }
      return null;
    }

    case "comp": {
      const i = state.compI;
      if (!params.competitors[i]) {
        state.phase = params.deep ? "deep" : "analyze";
        return null;
      }
      const cs = state.comps[i];
      const data = await deps.api.reviews(idParam(params.competitors[i]), "newestFirst", cs.token);
      cs.pages++;
      let tooOld = false;
      const limit = fromTs ? fromTs - params.windowDays * DAY : 0;
      for (const raw of data.reviews ?? []) {
        const r = normalizeReview(raw);
        if (limit && r.ts && r.ts < limit) {
          tooOld = true;
          continue;
        }
        r.text = r.text.slice(0, 400);
        r.user.thumbnail = "";
        cs.reviews.push(r);
      }
      cs.token = nextToken(data);
      if (tooOld || !cs.token || cs.pages >= params.maxCompPages) state.compI++;
      return null;
    }

    case "deep": {
      if (!state.queue) state.queue = buildQueue(params, state);
      if (state.deepI >= state.queue.length) {
        state.phase = "discover";
        return null;
      }
      const cid = state.queue[state.deepI++];
      try {
        const data = await deps.api.contributor(cid);
        const contrib = normalizeContributor(data);
        const negTs = state.client.reviews.filter((r) => r.user.contributorId === cid).map((r) => r.ts);
        state.profiles[cid] = profileFeatures(contrib, params.client, isAuto(params) ? [] : params.competitors, negTs);
        (state.positives ??= {})[cid] = positivesElsewhere(contrib, params.client, params.posThreshold)
          .slice(0, 150)
          .map((x) => ({ ...x, text: x.text.slice(0, 200) }));
      } catch (e) {
        // Un perfil privado o eliminado no debe tumbar el análisis.
        state.warnings.push(`No se pudo leer el perfil ${cid}: ${(e as Error).message}`);
      }
      return null;
    }

    case "discover": {
      const disc = discoverBeneficiaries(params.client, state.client.reviews, state.positives ?? {}, {
        minOverlap: Math.max(2, params.minOverlap ?? 2),
        windowDays: params.windowDays,
        mode: isAuto(params) ? "auto" : "manual",
        exclude: params.competitors
      });
      state.discovery = disc;
      if (isAuto(params)) {
        state.autoComps = disc.candidates
          .filter((c) => c.selected)
          .map((c) => placeFrom({ title: c.title, data_id: c.dataId, type: c.type, lat: c.lat, lng: c.lng }));
        attachCompHits(state.profiles, state.positives ?? {}, state.autoComps);
        state.comps = state.autoComps.map(() => ({ token: "", pages: 0, reviews: [] }));
        state.infoI = 0;
        state.phase = state.autoComps.length ? "compinfo" : "analyze";
        if (!state.autoComps.length) state.warnings.push("No se han encontrado negocios con suficientes autores en común; prueba a bajar el mínimo de coincidencias o ampliar el periodo.");
      } else {
        state.phase = "analyze";
      }
      return null;
    }

    case "compinfo": {
      // Datos de la ficha descubierta (nota, nº de reseñas, dirección) para el informe y el impacto.
      const comps = state.autoComps ?? [];
      const i = state.infoI ?? 0;
      if (i >= comps.length) {
        state.phase = "analyze";
        return null;
      }
      state.infoI = i + 1;
      const c = comps[i];
      if (c.dataId) {
        try {
          const data = await deps.api.reviews({ data_id: c.dataId }, "newestFirst");
          const pi = data.place_info ?? {};
          comps[i] = placeFrom({ ...pi, title: pi.title || c.title, data_id: c.dataId, type: pi.type || c.type, lat: c.lat, lng: c.lng, place_id: c.placeId });
        } catch (e) {
          state.warnings.push(`No se pudo leer la ficha de ${c.title}: ${(e as Error).message}`);
        }
      }
      return null;
    }

    case "analyze": {
      const comps = effectiveComps(params, state);
      const results = runAnalysis({ ...params, competitors: comps }, state.client.reviews, state.comps.map((c) => c.reviews), state.profiles);
      if (state.discovery) {
        results.discovery = state.discovery;
        results.findings = [...discoveryFindings(state.discovery), ...results.findings];
      }
      results.warnings = [...new Set(state.warnings)];
      state.phase = params.ai && deps.summarize ? "ai" : "done";
      state.resultsTmp = state.phase === "ai" ? results : null;
      return results;
    }

    case "ai": {
      const results = state.resultsTmp as AnalysisResults;
      try {
        results.aiSummary = await deps.summarize!(results);
      } catch (e) {
        results.warnings = [...(results.warnings ?? []), `Resumen IA no disponible: ${(e as Error).message}`];
      }
      state.resultsTmp = null;
      state.phase = "done";
      return results;
    }
  }
  state.phase = "done";
  return null;
}

/** Perfiles a investigar: primero los que ya cruzan con la competencia, luego los más recientes. */
function buildQueue(params: AnalysisParams, state: JobState): string[] {
  const compAuthors = new Set<string>();
  for (const cs of state.comps) for (const r of cs.reviews) if (r.user.contributorId) compAuthors.add(r.user.contributorId);
  const prio = new Map<string, number>();
  for (const r of state.client.reviews) {
    const cid = r.user.contributorId;
    if (!cid) continue;
    const p = (compAuthors.has(cid) ? 1e12 : 0) + r.ts;
    prio.set(cid, Math.max(prio.get(cid) ?? 0, p));
  }
  return [...prio.entries()].sort((a, b) => b[1] - a[1]).slice(0, params.maxDeep).map(([k]) => k);
}

export function progressOf(params: AnalysisParams, s: JobState): number {
  switch (s.phase) {
    case "client":
      return Math.min(14, 2 + s.client.pages * 2);
    case "comp": {
      const n = Math.max(1, params.competitors.length);
      const pages = s.comps[s.compI]?.pages ?? 0;
      return Math.floor(15 + (25 * (s.compI + Math.min(1, pages / Math.max(1, params.maxCompPages)))) / n);
    }
    case "deep": {
      const q = s.queue?.length ?? 0;
      const base = isAuto(params) ? 15 : 40;
      return q ? Math.floor(base + ((92 - base) * s.deepI) / q) : base;
    }
    case "discover":
      return 92;
    case "compinfo":
      return 93;
    case "analyze":
      return 94;
    case "ai":
      return 97;
  }
  return 100;
}

export function labelOf(params: AnalysisParams, s: JobState): string {
  switch (s.phase) {
    case "client":
      return `Leyendo reseñas negativas de ${params.client.title} (${s.client.reviews.length})`;
    case "comp": {
      const c = params.competitors[s.compI];
      return c ? `Leyendo reseñas de ${c.title} (${s.comps[s.compI].reviews.length})` : "Preparando cruce";
    }
    case "deep":
      return `Investigando historial de perfiles (${s.deepI}/${s.queue?.length ?? 0})`;
    case "discover":
      return "Buscando negocios con autores en común";
    case "compinfo":
      return "Leyendo las fichas de la competencia detectada";
    case "analyze":
      return "Calculando riesgo y cruces";
    case "ai":
      return "Redactando resumen ejecutivo con IA";
  }
  return "Completado";
}

/* ───────────────────────── IA ───────────────────────── */

export async function summarizeWithClaude(workspaceId: string, userId: string | null, res: AnalysisResults): Promise<string> {
  const top = res.authors.filter((a) => a.level !== "bajo").slice(0, 15);
  const compact = {
    cliente: { nombre: res.client.title, nota: res.client.rating, reseñas: res.client.reviews },
    competidores: res.competitors.map((c) => ({ nombre: c.title, nota: c.rating, reseñas: c.reviews })),
    estadisticas: res.stats,
    impacto_nota: res.impact,
    hallazgos: res.findings,
    perfiles_sospechosos: top.map((a) => ({
      nombre: a.name,
      riesgo: a.level,
      puntuacion: a.score,
      señales: a.signals.map((s) => s.label),
      negativas_cliente: a.clientReviews.map((r) => `${r.rating}★ ${r.date} «${r.text.slice(0, 160)}»`),
      reseñas_competencia: a.compReviews.map((r) => `${r.rating}★ ${r.date} ${r.title ?? ""}`)
    })),
    textos_similares: res.similar.slice(0, 5),
    negocios_beneficiados: res.discovery
      ? {
          modo: res.discovery.mode === "auto" ? "detección automática de competencia" : "otros negocios además de los competidores indicados",
          candidatos: res.discovery.candidates.slice(0, 8).map((c) => ({
            nombre: c.title, sector_igual: c.sameSector, km: c.km, autores_en_comun: c.count, en_ventana: c.fastCount, seleccionado: c.selected
          }))
        }
      : null
  };
  return (
    await complete({
      workspaceId,
      userId,
      feature: "gmb_fake_reviews",
      maxTokens: 1500,
      system:
        "Eres analista de reputación online de la agencia Negocio Vivo. Redactas en español el RESUMEN EJECUTIVO de un informe para un cliente sobre posibles reseñas falsas en su ficha de Google Business Profile. Reglas: 3 a 5 párrafos breves, tono profesional y claro para un empresario no técnico; usa lenguaje de indicios (\"patrón compatible con\", \"indicios de\") y nunca afirmes que la competencia es culpable, porque los datos públicos no prueban la autoría; destaca las cifras más relevantes y los 2-3 perfiles más llamativos con su evidencia concreta; termina con próximos pasos (denunciar cada reseña a Google, solicitar revisión, seguimiento mensual y, si procede, valoración con un abogado). Texto plano, sin markdown, sin títulos ni viñetas.",
      user: `Datos del análisis (JSON):\n${JSON.stringify(compact)}`
    })
  ).trim();
}

/* ───────────────────────── Runner con BD ───────────────────────── */

const LOCK_MS = 90_000;

export async function runAnalysisJob(workspaceId: string, id: string, budgetMs = 20_000, deps?: Partial<Deps>) {
  const now = new Date();
  const locked = await prisma.gmbFakeReviewAnalysis.updateMany({
    where: { id, workspaceId, status: "running", OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + LOCK_MS) }
  });
  const row = await prisma.gmbFakeReviewAnalysis.findFirst({ where: { id, workspaceId } });
  if (!row || locked.count === 0) return row;

  const params = row.params as unknown as AnalysisParams;
  const state = ((row.state as unknown as JobState) ?? initState(params)) as JobState;
  let api = deps?.api;
  let error: string | null = null;
  let results: AnalysisResults | null = null;

  try {
    if (!api) {
      const key = await getSerpApiKey(workspaceId);
      if (!key) throw new SerpApiKeyMissingError();
      api = new SerpApiClient(key);
    }
    const summarize = deps?.summarize ?? ((r: AnalysisResults) => summarizeWithClaude(workspaceId, row.createdById, r));
    const start = Date.now();
    while (state.phase !== "done" && Date.now() - start < budgetMs) {
      const r = await tick(params, state, { api, summarize });
      if (r) results = r;
    }
  } catch (e) {
    error = (e as Error).message || "Error desconocido";
  }

  const done = !error && state.phase === "done";
  await prisma.gmbFakeReviewAnalysis.updateMany({
    where: { id, workspaceId },
    data: {
      state: (done ? { phase: "done", warnings: state.warnings } : state) as any,
      apiCalls: row.apiCalls + (api?.calls ?? 0),
      progress: done ? 100 : progressOf(params, state),
      stepLabel: error ? "Error" : done ? "Completado" : labelOf(params, state),
      lockedUntil: null,
      ...(results ? { results: results as any } : {}),
      ...(error ? { status: "error", lastError: error } : {}),
      ...(done ? { status: "done", finishedAt: new Date() } : {}),
      ...(done && isAuto(params)
        ? { label: `Auto: ${(state.autoComps ?? []).map((c) => c.title).join(", ") || "sin coincidencias"}`.slice(0, 250) }
        : {})
    }
  });
  return prisma.gmbFakeReviewAnalysis.findFirst({ where: { id, workspaceId } });
}

/** Continúa en segundo plano los análisis en curso (llamado desde gmbTick). */
export async function processAllFakeReviewJobs(max = 3, budgetMs = 25_000) {
  const rows = await prisma.gmbFakeReviewAnalysis.findMany({
    where: { status: "running", OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] },
    orderBy: { updatedAt: "asc" },
    take: max,
    select: { id: true, workspaceId: true }
  });
  for (const r of rows) {
    try {
      await runAnalysisJob(r.workspaceId, r.id, budgetMs);
    } catch (e) {
      console.warn("[fake-reviews] job", r.id, (e as Error).message);
    }
  }
}

/* ───────────────────────── Resolver ───────────────────────── */

async function expandShortUrl(url: string): Promise<string> {
  let u = url;
  for (let i = 0; i < 6; i++) {
    let host = "";
    try {
      host = new URL(u).hostname.toLowerCase();
    } catch {
      return u;
    }
    if (!/(goo\.gl|g\.co|share\.google)$/.test(host)) return u;
    const r = await fetch(u, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(() => null);
    const loc = r?.headers.get("location");
    if (!loc) return u;
    u = new URL(loc, u).toString();
  }
  return u;
}

export type ResolveResult = { place: Place } | { candidates: Place[] };

export async function resolvePlace(api: SerpApiClient, input: string): Promise<ResolveResult> {
  let q = input.trim();
  if (!q) throw new Error("Introduce el nombre o la URL de la ficha.");
  if (/^https?:\/\//i.test(q)) q = await expandShortUrl(q);
  const parsed = parsePlaceInput(q);

  if (parsed.dataId || parsed.placeId) {
    const id = parsed.dataId ? { data_id: parsed.dataId } : { place_id: parsed.placeId };
    const data = await api.reviews(id, "ratingLow");
    const pi = data.place_info ?? {};
    if (!pi.title) throw new Error("No se ha encontrado la ficha con ese identificador.");
    return { place: placeFrom({ ...pi, ...id, lat: parsed.lat, lng: parsed.lng }) };
  }

  const query = parsed.name || q;
  const ll = parsed.lat != null && parsed.lng != null ? `@${parsed.lat},${parsed.lng},15z` : undefined;
  const data = await api.searchPlaces(query, ll);
  if (data.place_results?.title) return { place: placeFrom(data.place_results) };
  const cands: Place[] = (data.local_results ?? []).slice(0, 6).map(placeFrom);
  if (!cands.length) throw new Error(`Google Maps no devuelve resultados para «${query}». Prueba con la URL de la ficha.`);
  return cands.length === 1 ? { place: cands[0] } : { candidates: cands };
}
