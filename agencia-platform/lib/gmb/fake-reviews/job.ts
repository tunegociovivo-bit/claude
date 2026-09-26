/**
 * Detector de reseñas falsas — ejecución por pasos y resolución de fichas.
 *
 * Fases: client → comp → deep → analyze → ai → done. Cada llamada trabaja un presupuesto de
 * tiempo (~20 s) y guarda el estado en GmbFakeReviewAnalysis.state, así que avanza tanto desde
 * la UI (polling) como desde el gmbTick del scheduler si se cierra la pestaña. Un lock
 * optimista (lockedUntil) evita que ambos trabajen a la vez.
 */
import { prisma } from "@/lib/db/prisma";
import { complete, completeJson } from "@/lib/ai/anthropic";
import { mergeFinding, POLICY_SCHEMA, POLICY_SYSTEM, policyUserPrompt, ruleViolations, type PolicyFinding } from "./policy";

const POLICY_MODEL = "claude-sonnet-4-6";
import type { ReviewSource } from "@/lib/integrations/serpapi";
import { getReviewSource } from "./provider";
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
import { buildFootprint, detectNetworks, placeKeyOf, type Footprint } from "./network";
import { afterAnalysis, lookupKnown } from "./shield";
import { analyzeCompetitorPositives, type KnownProfile } from "./compfakes";
import {
  attachCompHits,
  discoverBeneficiaries,
  discoveryFindings,
  sameSector,
  positivesElsewhere,
  profileFeatures,
  runAnalysis,
  type AnalysisResults,
  type Discovery,
  type PositiveElsewhere,
  type ProfileFeatures
} from "./analyzer";

export type JobState = {
  phase: "client" | "comp" | "deep" | "discover" | "compinfo" | "comppos" | "nearby" | "sweepselect" | "analyze" | "policy" | "ai" | "done";
  /** Huella del historial de cada perfil (para detectar redes). */
  footprints?: Record<string, Footprint>;
  /** Perfiles ya fichados en la base propia (se consulta una vez antes de puntuar). */
  known?: Record<string, KnownProfile>;
  policyI?: number;
  policyFindings?: PolicyFinding[];
  policyAi?: boolean;
  /** Auto sin historial de perfiles (Serper): barrido de negocios cercanos del mismo sector. */
  sweep?: boolean;
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
/** Barrido de competencia cercana (proveedores sin historial de perfiles). */
const SWEEP_MAX = 8;
const SWEEP_PAGES = 6;
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

type PolicyClassifier = (business: string, items: { id: string; rating: number; date: string; text: string }[]) => Promise<{ results: any[] }>;
type Deps = {
  api: ReviewSource;
  summarize?: (r: AnalysisResults) => Promise<string>;
  classify?: PolicyClassifier | null;
  /** Consulta la base de perfiles sospechosos (excluye los fichados sólo en esta misma ficha). */
  lookupKnown?: (cids: string[]) => Promise<Record<string, KnownProfile>>;
};
/** Páginas de reseñas recientes por competidor detectado para buscar positivas falsas. */
const COMPPOS_PAGES = 2;
const POLICY_BATCH = 20;

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
        state.phase = params.mode === "policy" ? "analyze" : isAuto(params) ? (deps.api.supportsContributor ? "deep" : "nearby") : "comp";
      }
      return null;
    }

    case "comp": {
      const i = state.compI;
      const compsNow = effectiveComps(params, state);
      if (!compsNow[i]) {
        if (state.sweep) state.phase = "sweepselect";
        else if (params.deep && deps.api.supportsContributor) state.phase = "deep";
        else {
          if (params.deep) state.warnings.push("El proveedor de reseñas actual (Serper) no permite revisar el historial de cada perfil; se ha hecho el cruce directo con la competencia.");
          state.phase = "analyze";
        }
        return null;
      }
      const cs = state.comps[i];
      const data = await deps.api.reviews(idParam(compsNow[i]), "newestFirst", cs.token);
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
      if (tooOld || !cs.token || cs.pages >= (state.sweep ? SWEEP_PAGES : params.maxCompPages)) state.compI++;
      return null;
    }

    case "nearby": {
      // Barrido: negocios del mismo sector cerca del cliente; luego se leen sus reseñas (fase comp).
      const q = params.client.type || params.client.title;
      const ll = params.client.lat != null && params.client.lng != null ? `@${params.client.lat},${params.client.lng},14z` : undefined;
      const data = await deps.api.searchPlaces(q, ll);
      const clientKey = (params.client.dataId || params.client.placeId || params.client.title).toLowerCase();
      const found: Place[] = (data.local_results ?? [])
        .map(placeFrom)
        .filter((p: Place) => (p.dataId || p.placeId) && (p.dataId || p.placeId || p.title).toLowerCase() !== clientKey && p.title !== params.client.title)
        .filter((p: Place) => !params.client.type || sameSector(p.type, params.client.type));
      state.autoComps = found.slice(0, SWEEP_MAX);
      state.comps = state.autoComps.map(() => ({ token: "", pages: 0, reviews: [] }));
      state.compI = 0;
      state.sweep = true;
      state.phase = state.autoComps.length ? "comp" : "analyze";
      if (!state.autoComps.length) state.warnings.push("No se han encontrado negocios del mismo sector cerca del cliente para el barrido.");
      return null;
    }

    case "sweepselect": {
      // Positivas de autores de negativas en cada negocio barrido → mismos criterios que el descubrimiento.
      const negAuthors = new Set(state.client.reviews.map((r) => r.user.contributorId).filter(Boolean));
      const positives: Record<string, PositiveElsewhere[]> = {};
      const swept = state.autoComps ?? [];
      swept.forEach((p, i) => {
        for (const r of state.comps[i]?.reviews ?? []) {
          const cid = r.user.contributorId;
          if (!cid || !negAuthors.has(cid) || r.rating < params.posThreshold) continue;
          (positives[cid] ??= []).push({ dataId: p.dataId, title: p.title, type: p.type, lat: p.lat, lng: p.lng, rating: r.rating, ts: r.ts, date: r.date, text: r.text.slice(0, 200), link: r.link });
        }
      });
      const disc = discoverBeneficiaries(params.client, state.client.reviews, positives, {
        minOverlap: Math.max(2, params.minOverlap ?? 2),
        windowDays: params.windowDays,
        mode: "auto"
      });
      disc.profilesScanned = negAuthors.size;
      disc.method = "sweep";
      disc.sweptPlaces = swept.map((p, i) => ({ title: p.title, reviewsRead: state.comps[i]?.reviews.length ?? 0 }));
      // Todos los barridos son del mismo sector: se analizan los que superan el mínimo.
      for (const c of disc.candidates) c.selected = true;
      const keep = swept.map((p, i) => ({ p, i })).filter(({ p }) => disc.candidates.some((c) => (c.dataId && c.dataId === p.dataId) || c.title === p.title));
      state.discovery = disc;
      state.autoComps = keep.map(({ p }) => p);
      state.comps = keep.map(({ i }) => state.comps[i]);
      state.sweep = false;
      state.phase = "analyze";
      if (!keep.length) state.warnings.push("Ningún negocio cercano del mismo sector acumula suficientes autores en común con las negativas del cliente.");
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
        (state.footprints ??= {})[cid] = buildFootprint(contrib, params.client);
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
        state.compI = 0;
        state.phase = params.compFakes !== false && comps.length ? "comppos" : "analyze";
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

    case "comppos": {
      // Reseñas recientes de la competencia detectada: cruce directo + positivas sospechosas.
      const comps = effectiveComps(params, state);
      const i = state.compI;
      if (!comps[i]) {
        state.phase = "analyze";
        return null;
      }
      const cs = (state.comps[i] ??= { token: "", pages: 0, reviews: [] });
      const data = await deps.api.reviews(idParam(comps[i]), "newestFirst", cs.token || undefined);
      cs.pages++;
      for (const raw of data.reviews ?? []) {
        const r = normalizeReview(raw);
        r.text = r.text.slice(0, 400);
        r.user.thumbnail = "";
        cs.reviews.push(r);
      }
      cs.token = nextToken(data);
      if (!cs.token || cs.pages >= COMPPOS_PAGES) state.compI++;
      return null;
    }

    case "analyze": {
      const comps = effectiveComps(params, state);
      if (state.known === undefined) {
        const cids = [...new Set(state.client.reviews.map((r) => r.user.contributorId).filter(Boolean))];
        for (const cs of state.comps) for (const r of cs.reviews) if (r.user.contributorId && r.rating >= params.posThreshold) cids.push(r.user.contributorId);
        try {
          state.known = deps.lookupKnown && cids.length ? await deps.lookupKnown([...new Set(cids)]) : {};
        } catch (e) {
          state.known = {};
          state.warnings.push(`No se pudo consultar la base de perfiles sospechosos: ${(e as Error).message}`);
        }
      }
      const names: Record<string, string> = {};
      for (const r of state.client.reviews) if (r.user.contributorId) names[r.user.contributorId] = r.user.name;
      const networks = detectNetworks(state.footprints ?? {}, names, { windowDays: Math.max(30, params.windowDays * 2) });
      const results = runAnalysis({ ...params, competitors: comps }, state.client.reviews, state.comps.map((c) => c.reviews), state.profiles, {
        networks,
        known: state.known
      });
      if (comps.length && params.compFakes !== false && params.mode !== "policy") {
        const netBy = new Map(networks.flatMap((n) => n.members.map((m) => [m, n] as const)));
        const cf = analyzeCompetitorPositives(comps, state.comps.map((c) => c.reviews), {
          posThreshold: Math.max(4, params.posThreshold),
          clientNegAuthors: new Set(state.client.reviews.map((r) => r.user.contributorId).filter(Boolean)),
          known: state.known,
          networks: netBy
        });
        if (cf.length) {
          results.compFakes = cf;
          const n = cf.reduce((s, c) => s + c.suspicious.length, 0);
          const sp = cf.filter((c) => c.spikes.length);
          if (n) results.findings.push(`Se han detectado ${n} valoraciones positivas sospechosas en la competencia (${cf.filter((c) => c.suspicious.length).map((c) => `${c.title}: ${c.suspicious.length}`).join("; ")}).`);
          if (sp.length) results.findings.push(`${sp.map((c) => c.title).join(", ")} ${sp.length === 1 ? "presenta" : "presentan"} semanas con un pico anómalo de valoraciones de 5★.`);
        }
      }
      if (state.discovery) {
        results.discovery = state.discovery;
        results.findings = [...discoveryFindings(state.discovery), ...results.findings];
      }
      results.warnings = [...new Set(state.warnings)];
      results.mode = params.mode ?? "manual";
      const wantPolicy = params.mode === "policy" || !!params.policy;
      state.phase = wantPolicy ? "policy" : params.ai && deps.summarize ? "ai" : "done";
      state.resultsTmp = state.phase === "done" ? null : results;
      state.policyI = 0;
      state.policyFindings = [];
      state.policyAi = false;
      return results;
    }

    case "policy": {
      const results = state.resultsTmp as AnalysisResults;
      const withText = state.client.reviews.filter((r) => r.text.trim());
      const i = state.policyI ?? 0;
      const batch = withText.slice(i, i + POLICY_BATCH);
      let ai: Map<string, any> | null = null;
      if (batch.length && deps.classify) {
        try {
          const res = await deps.classify(
            `${params.client.title}${params.client.address ? ` (${params.client.address})` : ""}${params.client.type ? ` — ${params.client.type}` : ""}`,
            batch.map((r) => ({ id: r.reviewId, rating: r.rating, date: r.date, text: r.text.slice(0, 1500) }))
          );
          ai = new Map((res?.results ?? []).map((x: any) => [String(x.id), x]));
          state.policyAi = true;
        } catch (e) {
          state.warnings.push(`Revisión de contenido con IA no disponible (se usan solo reglas): ${(e as Error).message}`);
          deps.classify = null;
        }
      }
      for (const r of batch) {
        const f = mergeFinding(
          { reviewId: r.reviewId, author: r.user.name, authorLink: r.user.link, rating: r.rating, date: r.date, text: r.text, link: r.link },
          ruleViolations(r.text),
          ai?.get(r.reviewId) ?? null
        );
        if (f) (state.policyFindings ??= []).push(f);
      }
      state.policyI = i + POLICY_BATCH;
      if (state.policyI < withText.length) return null;
      const order = { alta: 0, media: 1, baja: 2 } as const;
      results.policy = {
        checked: withText.length,
        aiUsed: !!state.policyAi,
        findings: (state.policyFindings ?? []).sort((a, b) => order[a.likelihood] - order[b.likelihood])
      };
      const hi = results.policy.findings.filter((f) => f.likelihood !== "baja").length;
      results.findings = [
        ...results.findings,
        hi
          ? `${hi} de las ${withText.length} reseñas negativas con texto incumplen claramente o con indicios razonables la política de contenido de Google (insultos, lenguaje soez, datos personales, conflicto de intereses…).`
          : `Ninguna de las ${withText.length} reseñas negativas con texto incumple de forma clara la política de contenido de Google.`
      ];
      if (params.mode === "policy") results.findings = results.findings.filter((f) => !/perfiles que han dejado reseñas negativas|riesgo ALTO/.test(f));
      results.warnings = [...new Set([...(results.warnings ?? []), ...state.warnings])];
      state.policyFindings = [];
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
    case "comppos": {
      const n = Math.max(1, effectiveComps(params, s).length);
      return Math.min(94, Math.floor(93 + s.compI / n));
    }
    case "comp": {
      const n = Math.max(1, effectiveComps(params, s).length);
      const pages = s.comps[s.compI]?.pages ?? 0;
      const maxP = s.sweep ? SWEEP_PAGES : params.maxCompPages;
      const span = s.sweep ? 75 : 25;
      return Math.floor(15 + (span * (s.compI + Math.min(1, pages / Math.max(1, maxP)))) / n);
    }
    case "deep": {
      const q = s.queue?.length ?? 0;
      const base = isAuto(params) ? 15 : 40;
      return q ? Math.floor(base + ((92 - base) * s.deepI) / q) : base;
    }
    case "nearby":
      return 16;
    case "sweepselect":
      return 92;
    case "discover":
      return 92;
    case "compinfo":
      return 93;
    case "analyze":
      return 94;
    case "policy":
      return 95;
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
      const c = effectiveComps(params, s)[s.compI];
      const prefix = s.sweep ? `Barrido ${s.compI + 1}/${effectiveComps(params, s).length} · ` : "";
      return c ? `${prefix}Leyendo reseñas de ${c.title} (${s.comps[s.compI].reviews.length})` : "Preparando cruce";
    }
    case "deep":
      return `Investigando historial de perfiles (${s.deepI}/${s.queue?.length ?? 0})`;
    case "nearby":
      return "Buscando negocios del mismo sector cerca del cliente";
    case "sweepselect":
      return "Cruzando autores con la competencia cercana";
    case "discover":
      return "Buscando negocios con autores en común";
    case "compinfo":
      return "Leyendo las fichas de la competencia detectada";
    case "comppos": {
      const c = effectiveComps(params, s)[s.compI];
      return c ? `Buscando positivas sospechosas en ${c.title}` : "Buscando positivas sospechosas en la competencia";
    }
    case "analyze":
      return "Calculando riesgo y cruces";
    case "policy":
      return `Revisando el contenido de las reseñas frente a las políticas de Google (${s.policyI ?? 0}/${s.client.reviews.filter((r) => r.text.trim()).length})`;
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
    revision_contenido: res.policy
      ? {
          revisadas: res.policy.checked,
          incumplen: res.policy.findings.filter((f) => f.likelihood !== "baja").length,
          ejemplos: res.policy.findings.slice(0, 5).map((f) => ({ probabilidad: f.likelihood, motivos: f.violations.map((v) => v.category), texto: f.text.slice(0, 160) }))
        }
      : null,
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
    if (!api) api = await getReviewSource(workspaceId);
    const summarize = deps?.summarize ?? ((r: AnalysisResults) => summarizeWithClaude(workspaceId, row.createdById, r));
    const classify: PolicyClassifier | null =
      deps?.classify !== undefined
        ? deps.classify
        : (business, items) =>
            completeJson<{ results: any[] }>({
              workspaceId,
              userId: row.createdById,
              feature: "gmb_fake_reviews_policy",
              model: POLICY_MODEL,
              maxTokens: 8000,
              schema: POLICY_SCHEMA,
              system: POLICY_SYSTEM,
              user: policyUserPrompt(business, items)
            });
    const placeKey = placeKeyOf(params.client.dataId || params.client.placeId, params.client.title);
    const tickDeps: Deps = {
      api,
      summarize,
      classify,
      lookupKnown: deps?.lookupKnown ?? ((cids) => lookupKnown(workspaceId, cids, placeKey))
    };
    const start = Date.now();
    while (state.phase !== "done" && Date.now() - start < budgetMs) {
      const r = await tick(params, state, tickDeps);
      if (r) results = r;
    }
  } catch (e) {
    error = (e as Error).message || "Error desconocido";
  }

  const done = !error && state.phase === "done";
  if (done && results && !deps?.api) {
    // Perfiles a la base propia y reseñas denunciables al centro de retiradas.
    const created = await afterAnalysis(workspaceId, id, results, row.createdById);
    (results as any).casesCreated = created;
  }
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

export async function resolvePlace(api: ReviewSource, input: string): Promise<ResolveResult> {
  let q = input.trim();
  if (!q) throw new Error("Introduce el nombre o la URL de la ficha.");
  if (/^https?:\/\//i.test(q)) q = await expandShortUrl(q);
  const parsed = parsePlaceInput(q);

  if ((parsed.dataId || parsed.placeId) && api.provider === "serpapi") {
    const id = parsed.dataId ? { data_id: parsed.dataId } : { place_id: parsed.placeId };
    const data = await api.reviews(id, "ratingLow");
    const pi = data.place_info ?? {};
    if (pi.title) return { place: placeFrom({ ...pi, ...id, lat: parsed.lat, lng: parsed.lng }) };
    if (!parsed.name) throw new Error("No se ha encontrado la ficha con ese identificador.");
  } else if ((parsed.dataId || parsed.placeId) && !parsed.name) {
    throw new Error("Con este proveedor busca la ficha por nombre y ciudad, o pega la URL completa de Google Maps (/maps/place/…).");
  }

  const query = parsed.name || q;
  const ll = parsed.lat != null && parsed.lng != null ? `@${parsed.lat},${parsed.lng},15z` : undefined;
  const data = await api.searchPlaces(query, ll);
  if (data.place_results?.title) return { place: placeFrom(data.place_results) };
  const all: Place[] = (data.local_results ?? []).map(placeFrom);
  // Si la URL traía el identificador, elegimos esa ficha exacta entre los resultados.
  const exact = all.find((p) => (parsed.dataId && p.dataId.toLowerCase() === parsed.dataId) || (parsed.placeId && p.placeId === parsed.placeId));
  if (exact) return { place: exact };
  const cands: Place[] = all.slice(0, 6);
  if (!cands.length) throw new Error(`Google Maps no devuelve resultados para «${query}». Prueba con la URL de la ficha.`);
  return cands.length === 1 ? { place: cands[0] } : { candidates: cands };
}
