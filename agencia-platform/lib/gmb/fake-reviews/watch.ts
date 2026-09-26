/**
 * Vigilancia diaria de fichas: detecta reseñas negativas nuevas, las puntúa al momento (perfil,
 * base de sospechosos, contenido), abre el caso en el centro de retiradas con sus pruebas, detecta
 * ataques (picos de negativas) y, una vez por semana, picos de 5★ en la competencia.
 *
 * Fuente: API oficial de Google si la ficha es del hub y está conectada (gratis); si no, SerpApi/Serper.
 */
import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/ai/anthropic";
import type { ReviewSource } from "@/lib/integrations/serpapi";
import { getReviewSource } from "./provider";
import { idParam, nextToken, normalizeContributor, normalizeReview, type Place, type Review } from "./core";
import { profileFeatures, runAnalysis, type AnalysisResults } from "./analyzer";
import { analyzeCompetitorPositives } from "./compfakes";
import { mergeFinding, POLICY_SCHEMA, POLICY_SYSTEM, policyUserPrompt, ruleViolations, type PolicyFinding } from "./policy";
import { FAKE_POLICY, reasonsFromPolicy, type CaseReason } from "./cases-logic";
import { attackCheck, mergeKnown, newReviews, pushHistory, recentSpike, reviewKey, type WatchHistoryEntry } from "./watch-logic";
import { getLearningStats, lookupKnown, managedLocationFor, officialReviews, upsertCase, upsertProfile } from "./shield";
import { placeKeyOf } from "./network";
import { notifyChannels, raiseAlert, type ShieldAlert } from "./notify";

type Memory = { ids: string[]; negTs: number[]; negCids: string[] };
type CompMem = Record<string, { ids: string[]; posTs: number[] }>;

const LOCK_MS = 120_000;
const MAX_NEW_NEG = 8;
const WEEK = 7 * 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);

/** Reseñas más recientes; deja de paginar en cuanto aparece una ya conocida (ahorra búsquedas). */
async function freshReviews(api: ReviewSource, place: Place, maxPages = 3, known?: string[]): Promise<{ list: Review[]; info: any }> {
  const list: Review[] = [];
  const seen = new Set(known ?? []);
  let token = "";
  let info: any = null;
  for (let i = 0; i < maxPages; i++) {
    const data = await api.reviews(idParam(place), "newestFirst", token || undefined);
    info ??= data.place_info ?? null;
    const page = (data.reviews ?? []).map((raw: any) => normalizeReview(raw));
    list.push(...page);
    token = nextToken(data);
    if (!token || !known || page.some((r: Review) => seen.has(reviewKey(r)))) break;
  }
  return { list, info };
}

function watchParams(place: Place, comps: Place[]) {
  return {
    mode: "manual" as const,
    client: place,
    competitors: comps,
    negThreshold: 2,
    posThreshold: 4,
    windowDays: 30,
    dateFrom: "",
    deep: true,
    ai: false,
    maxClientPages: 1,
    maxCompPages: 1,
    maxDeep: 10
  };
}

export async function runWatch(workspaceId: string, watchId: string, opts: { force?: boolean } = {}) {
  const now = new Date();
  const locked = await prisma.gmbReviewWatch.updateMany({
    where: { id: watchId, workspaceId, ...(opts.force ? {} : { enabled: true }), OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + LOCK_MS) }
  });
  const w = await prisma.gmbReviewWatch.findFirst({ where: { id: watchId, workspaceId } });
  if (!w || !locked.count) return w;

  const place = w.place as unknown as Place;
  const comps = ((w.competitors as unknown as Place[] | null) ?? []).slice(0, 5);
  const placeKey = placeKeyOf(place.dataId || place.placeId, place.title);
  const mem: Memory = { ids: [], negTs: [], negCids: [], ...((w.knownIds as any) ?? {}) };
  const firstRun = !w.lastRunAt;
  let history = ((w.history as unknown as WatchHistoryEntry[] | null) ?? []).slice();
  const compMem: CompMem = ((w.compState as any) ?? {}) as CompMem;
  const alerts: ShieldAlert[] = [];
  let api: ReviewSource | null = null;
  let calls = 0;
  let error: string | null = null;
  let compRan = false;

  try {
    // 1) Reseñas recientes: API oficial (gratis) o proveedor.
    const loc = await managedLocationFor(workspaceId, place, w.gmbClientId).catch(() => null);
    let list: Review[] = [];
    let rating: number | null = place.rating;
    let total: number | null = place.reviews;
    let source = "serpapi";
    if (loc) {
      try {
        list = (await officialReviews(workspaceId, loc, 2)) as Review[];
        source = "gbp";
        const gc = w.gmbClientId ? await prisma.gmbClient.findFirst({ where: { id: w.gmbClientId, workspaceId }, select: { rating: true, reviewCount: true } }) : null;
        if (gc?.rating) rating = gc.rating;
        if (gc?.reviewCount) total = gc.reviewCount;
      } catch {
        list = [];
      }
    }
    if (!list.length) {
      api = await getReviewSource(workspaceId, { cacheDays: 0 });
      const r = await freshReviews(api, place, firstRun ? 1 : 3, firstRun ? undefined : mem.ids);
      list = r.list;
      source = api.provider;
      if (r.info?.rating != null) rating = Number(r.info.rating);
      if (r.info?.reviews != null) total = Number(r.info.reviews);
    }

    const fresh = firstRun ? [] : newReviews(mem.ids, list);
    const newNeg = fresh.filter((r) => r.rating <= 2).slice(0, MAX_NEW_NEG);
    for (const r of list) if (r.rating <= 2 && r.ts && !mem.negTs.includes(r.ts)) mem.negTs.push(r.ts);
    mem.negTs = mem.negTs.sort((a, b) => b - a).slice(0, 300);
    mem.ids = mergeKnown(mem.ids, list);
    let flagged = 0;

    if (newNeg.length) {
      // 2) Autor: con la API oficial no hay id de perfil → se cruza con una página del proveedor.
      if (source === "gbp" && w.deepCheck) {
        try {
          api ??= await getReviewSource(workspaceId, { cacheDays: 0 });
          const r = await freshReviews(api, place, 1);
          for (const n of newNeg) {
            const m = r.list.find((x) => x.user.name === n.user.name && x.rating === n.rating);
            if (m) {
              n.user = { ...m.user };
              n.link = m.link;
              if (!n.reviewId || n.reviewId.startsWith("gbp:")) n.reviewId = m.reviewId || n.reviewId;
            }
          }
        } catch {
          /* sin proveedor: se sigue sin perfil */
        }
      }
      for (const n of newNeg) if (n.user.contributorId) mem.negCids = [...new Set([n.user.contributorId, ...mem.negCids])].slice(0, 300);

      // 3) Contenido: reglas + IA (una sola llamada para todas las nuevas).
      let ai: Map<string, any> | null = null;
      const withText = newNeg.filter((r) => r.text.trim());
      if (w.aiCheck && withText.length) {
        try {
          const res = await completeJson<{ results: any[] }>({
            workspaceId,
            userId: w.createdById,
            feature: "gmb_review_watch",
            model: "claude-sonnet-4-6",
            maxTokens: 4000,
            schema: POLICY_SCHEMA,
            system: POLICY_SYSTEM,
            user: policyUserPrompt(place.title, withText.map((r) => ({ id: reviewKey(r), rating: r.rating, date: r.date, text: r.text.slice(0, 1500) })))
          });
          ai = new Map((res?.results ?? []).map((x: any) => [String(x.id), x]));
        } catch {
          ai = null;
        }
      }

      // 4) Perfil de cada autor + base de sospechosos.
      const cids = newNeg.map((r) => r.user.contributorId).filter(Boolean);
      const known = await lookupKnown(workspaceId, cids, placeKey).catch(() => ({}));
      const allKnown = cids.length
        ? await prisma.gmbReviewerProfile.findMany({ where: { workspaceId, contributorId: { in: cids }, status: { not: "descartado" } }, select: { contributorId: true, timesFlagged: true, status: true } })
        : [];
      const profiles: Record<string, ReturnType<typeof profileFeatures>> = {};
      if (w.deepCheck && cids.length) {
        api ??= await getReviewSource(workspaceId, { cacheDays: 0 }).catch(() => null);
        if (api?.supportsContributor) {
          for (const n of newNeg) {
            const cid = n.user.contributorId;
            if (!cid || profiles[cid]) continue;
            try {
              const c = normalizeContributor(await api.contributor(cid));
              profiles[cid] = profileFeatures(c, place, comps, [n.ts]);
            } catch {
              /* perfil privado */
            }
          }
        }
      }
      const res: AnalysisResults = runAnalysis(watchParams(place, comps), newNeg, comps.map(() => []), profiles, { known });
      const stats = await getLearningStats(workspaceId).catch(() => null);

      for (const n of newNeg) {
        const author = res.authors.find((a) => a.clientReviews.some((x) => x.reviewId === n.reviewId));
        const pf: PolicyFinding | null = n.text.trim()
          ? mergeFinding({ reviewId: n.reviewId, author: n.user.name, authorLink: n.user.link, rating: n.rating, date: n.date, text: n.text, link: n.link }, ruleViolations(n.text), ai?.get(reviewKey(n)) ?? null)
          : null;
        const kn = allKnown.find((k) => k.contributorId === n.user.contributorId);
        const reasons: CaseReason[] = [];
        if (author && author.level !== "bajo") {
          reasons.push({
            kind: "fake",
            category: "fake",
            label: author.crossPos > 0 ? "Perfil vinculado a la competencia" : "Perfil con patrón de reseña no auténtica",
            policy: FAKE_POLICY,
            detail: `${author.signals.filter((s) => s.points > 0).map((s) => s.label + (s.detail ? ` (${s.detail})` : "")).join("; ")}. Riesgo ${author.score}/100.`
          });
        }
        if (kn) reasons.push({ kind: "known", label: "Perfil reincidente", policy: FAKE_POLICY, detail: kn.status === "confirmado" ? "Google ya retiró reseñas de este perfil." : `Ya marcado como sospechoso ${kn.timesFlagged} vez/veces.` });
        if (pf && pf.likelihood !== "baja") reasons.push(...reasonsFromPolicy(pf.violations));
        const who = `«${n.user.name || "Usuario de Google"}» · ${n.rating}★`;
        if (!reasons.length) {
          alerts.push({
            type: "suspicious_review",
            severity: "info",
            title: `Nueva reseña negativa en ${place.title}`,
            body: `${who}: «${n.text.slice(0, 200) || "sin texto"}». Sin indicios claros de reseña falsa ni de incumplimiento de políticas.`,
            dedupKey: `rw:${w.id}:${reviewKey(n)}`
          });
          continue;
        }
        flagged++;
        const score = Math.max(author?.score ?? 0, pf?.likelihood === "alta" ? 80 : pf?.likelihood === "media" ? 55 : 0, kn ? 60 : 0);
        await upsertCase(
          workspaceId,
          {
            target: "cliente",
            place,
            reviewId: n.reviewId,
            reviewLink: n.link,
            author: n.user.name,
            authorLink: n.user.link,
            contributorId: n.user.contributorId,
            rating: n.rating,
            reviewDate: n.date,
            text: n.text,
            reasons,
            score,
            likelihood: score >= 60 ? "alta" : "media",
            watchId: w.id,
            source,
            evidence: author ? { perfil: { nombre: author.name, reseñas: author.totalReviews, señales: author.signals.map((s) => `${s.points > 0 ? "+" : ""}${s.points} ${s.label} ${s.detail}`) } } : undefined
          },
          stats,
          w.createdById
        ).catch(() => null);
        if (author && author.cid && author.level !== "bajo") {
          await upsertProfile(workspaceId, {
            cid: author.cid, name: author.name, link: author.link, score: author.score, level: author.level,
            place: { key: placeKey, title: place.title, watchId: w.id, at: new Date().toISOString(), score: author.score, role: "negativa al cliente" },
            signals: author.signals.map((s) => ({ label: s.label, points: s.points }))
          }).catch(() => undefined);
        }
        alerts.push({
          type: kn ? "known_profile" : "suspicious_review",
          severity: kn || score >= 60 ? "critical" : "warning",
          title: kn ? `Perfil reincidente ha reseñado ${place.title}` : `Reseña negativa sospechosa en ${place.title}`,
          body: `${who}: «${n.text.slice(0, 200) || "sin texto"}».\nMotivos: ${reasons.map((r) => r.label).join(", ")}.\nLa denuncia ya está preparada en el centro de retiradas.`,
          dedupKey: `rw:${w.id}:${reviewKey(n)}`
        });
      }
    }

    // 5) ¿Ataque? Pico de negativas en 72 h.
    const atk = attackCheck(mem.negTs);
    if (!firstRun && atk.attack) {
      alerts.push({
        type: "review_attack",
        severity: "critical",
        title: `Posible ataque de reseñas a ${place.title}`,
        body: `${atk.recent} reseñas negativas en las últimas 72 horas (lo habitual es ${atk.baseline}). Revisa las denuncias preparadas y responde públicamente con calma.`,
        dedupKey: `rw-attack:${w.id}:${today()}`
      });
    }

    // 6) Competencia: una vez por semana, positivas recientes → picos y reseñas sospechosas.
    if (comps.length && (!w.lastCompRunAt || now.getTime() - w.lastCompRunAt.getTime() >= WEEK - 3_600_000)) {
      api ??= await getReviewSource(workspaceId, { cacheDays: 0 });
      const stats = await getLearningStats(workspaceId).catch(() => null);
      for (const c of comps) {
        const ck = placeKeyOf(c.dataId || c.placeId, c.title);
        const cm = compMem[ck] ?? { ids: [], posTs: [] };
        try {
          const r = await freshReviews(api, c, 2, cm.ids.length ? cm.ids : undefined);
          const pos = r.list.filter((x) => x.rating >= 4);
          const freshPos = cm.ids.length ? newReviews(cm.ids, pos) : [];
          for (const p of pos) if (p.ts && !cm.posTs.includes(p.ts)) cm.posTs.push(p.ts);
          cm.posTs = cm.posTs.sort((a, b) => b - a).slice(0, 600);
          cm.ids = mergeKnown(cm.ids, pos, 600);
          compMem[ck] = cm;
          const spike = recentSpike(cm.posTs);
          const known = await lookupKnown(workspaceId, freshPos.map((x) => x.user.contributorId).filter(Boolean), ck).catch(() => ({}));
          const cf = analyzeCompetitorPositives([c], [freshPos], { posThreshold: 4, clientNegAuthors: new Set(mem.negCids), known })[0];
          const sus = (cf?.suspicious ?? []).filter((x) => x.score >= 60);
          for (const s of sus) {
            await upsertCase(
              workspaceId,
              {
                target: "competidor", place: c, reviewId: s.reviewId, reviewLink: s.link, author: s.author, authorLink: s.authorLink,
                contributorId: s.contributorId, rating: s.rating, reviewDate: s.date, text: s.text,
                reasons: [{ kind: "competitor", label: "Positiva sospechosa en la competencia", policy: FAKE_POLICY, detail: s.reasons.join("; ") }],
                score: s.score, likelihood: s.score >= 80 ? "alta" : "media", watchId: w.id, source: api.provider
              },
              stats,
              w.createdById
            ).catch(() => null);
          }
          if (spike || sus.length >= 3) {
            alerts.push({
              type: "competitor_spike",
              severity: "warning",
              title: spike ? `Pico de reseñas de 5★ en ${c.title}` : `Positivas sospechosas en ${c.title}`,
              body: spike
                ? `${spike.count} valoraciones positivas la semana del ${spike.week.split("-").reverse().join("/")} (lo habitual: ${spike.baseline}).${sus.length ? ` ${sus.length} parecen no auténticas y se han preparado para denunciar.` : ""}`
                : `${sus.length} valoraciones positivas recientes con indicios de no ser auténticas; preparadas en el centro de retiradas.`,
              dedupKey: `rw-comp:${w.id}:${ck}:${spike?.week ?? today()}`
            });
          }
        } catch (e) {
          console.warn("[escudo] competidor", c.title, (e as Error).message);
        }
      }
      compRan = true;
    }

    history = pushHistory(history, { d: today(), rating, reviews: total, newReviews: fresh.length, newNeg: newNeg.length, flagged });
  } catch (e) {
    error = (e as Error).message || "Error desconocido";
  }

  calls = api?.calls ?? 0;
  const created: ShieldAlert[] = [];
  for (const a of alerts) if (await raiseAlert(workspaceId, a).catch(() => false)) created.push(a);
  if (created.length) await notifyChannels(workspaceId, { name: w.name, emails: w.emails, whatsapp: w.whatsapp }, created);

  await prisma.gmbReviewWatch.updateMany({
    where: { id: w.id, workspaceId },
    data: {
      knownIds: mem as any,
      history: history as any,
      compState: compMem as any,
      lastRunAt: now,
      nextRunAt: new Date(now.getTime() + Math.max(1, w.frequencyHours) * 3_600_000),
      ...(compRan ? { lastCompRunAt: now } : {}),
      lastError: error,
      lockedUntil: null,
      apiCalls: w.apiCalls + calls
    }
  });
  return prisma.gmbReviewWatch.findFirst({ where: { id: w.id, workspaceId } });
}

/** Vigilancias vencidas (llamado desde gmbTick). */
export async function processDueWatches(max = 3) {
  const rows = await prisma.gmbReviewWatch.findMany({
    where: { enabled: true, nextRunAt: { lte: new Date() }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] },
    orderBy: { nextRunAt: "asc" },
    take: max,
    select: { id: true, workspaceId: true }
  });
  for (const r of rows) {
    try {
      await runWatch(r.workspaceId, r.id);
    } catch (e) {
      console.warn("[escudo] vigilancia", r.id, (e as Error).message);
    }
  }
}
