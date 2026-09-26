/**
 * Escudo de reputación — capa de datos: base de perfiles sospechosos, centro de retiradas,
 * pruebas con huella SHA-256, aprendizaje y conexión con la API oficial de Google.
 */
import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { gmbListAllReviews, gmbLocationPath } from "@/lib/integrations/gmb";
import { LEVEL_MEDIUM, type AnalysisResults } from "./analyzer";
import { buildGoogleCase } from "./google";
import { placeKeyOf } from "./network";
import type { KnownProfile } from "./compfakes";
import {
  FAKE_POLICY,
  GOOGLE_OPTIONS,
  calibratedLikelihood,
  learningStats,
  pickOption,
  reasonsFromPolicy,
  reportText,
  type CaseReason,
  type LearningStats
} from "./cases-logic";
import type { Place } from "./core";

/* ───────────────────────── Pruebas ───────────────────────── */

export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as any)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as any)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function saveEvidence(
  workspaceId: string,
  caseId: string,
  e: { kind: "review" | "profile" | "check"; source: string; url?: string; payload: Record<string, unknown> }
) {
  const capturedAt = new Date();
  const payload = { ...e.payload, capturedAt: capturedAt.toISOString() };
  return prisma.gmbEvidence.create({
    data: { workspaceId, caseId, kind: e.kind, source: e.source, url: e.url ?? "", payload: payload as any, sha256: sha256(canonicalJson(payload)), capturedAt }
  });
}

/* ───────────────────────── Base de perfiles ───────────────────────── */

type ProfilePlace = { key: string; title: string; analysisId?: string; watchId?: string; at: string; score: number; role?: string };

/** Perfiles ya fichados (fuera de la ficha actual) o confirmados por Google. */
export async function lookupKnown(workspaceId: string, cids: string[], currentPlaceKey: string): Promise<Record<string, KnownProfile>> {
  if (!cids.length) return {};
  const rows = await prisma.gmbReviewerProfile.findMany({
    where: { workspaceId, contributorId: { in: cids.slice(0, 2000) }, status: { not: "descartado" } },
    select: { contributorId: true, timesFlagged: true, status: true, maxScore: true, places: true }
  });
  const out: Record<string, KnownProfile> = {};
  for (const r of rows) {
    const places = ((r.places as ProfilePlace[] | null) ?? []).filter((p) => p.key !== currentPlaceKey);
    if (!places.length && r.status !== "confirmado") continue;
    out[r.contributorId] = { timesFlagged: r.timesFlagged, status: r.status, maxScore: r.maxScore, places: [...new Set(places.map((p) => p.title))] };
  }
  return out;
}

export async function upsertProfile(
  workspaceId: string,
  p: { cid: string; name: string; link: string; score: number; level: string; place: ProfilePlace; signals?: unknown; network?: string }
) {
  const existing = await prisma.gmbReviewerProfile.findUnique({ where: { workspaceId_contributorId: { workspaceId, contributorId: p.cid } } });
  const places = ((existing?.places as ProfilePlace[] | null) ?? []).filter(
    (x) => !(x.key === p.place.key && ((p.place.analysisId && x.analysisId === p.place.analysisId) || (p.place.watchId && x.watchId === p.place.watchId)))
  );
  const already = places.some((x) => x.key === p.place.key);
  places.unshift(p.place);
  const nets = new Set<string>(((existing?.networks as string[] | null) ?? []).concat(p.network ? [p.network] : []));
  const rank = { alto: 2, medio: 1, bajo: 0 } as Record<string, number>;
  const level = existing && rank[existing.level] > rank[p.level] ? existing.level : p.level;
  if (!existing) {
    await prisma.gmbReviewerProfile.create({
      data: {
        workspaceId, contributorId: p.cid, name: p.name.slice(0, 200), link: p.link.slice(0, 500), maxScore: p.score, level,
        timesFlagged: 1, places: places.slice(0, 50) as any, networks: [...nets].slice(0, 20) as any, signals: (p.signals ?? null) as any
      }
    });
    return;
  }
  await prisma.gmbReviewerProfile.updateMany({
    where: { id: existing.id, workspaceId },
    data: {
      name: p.name ? p.name.slice(0, 200) : existing.name,
      link: p.link ? p.link.slice(0, 500) : existing.link,
      maxScore: Math.max(existing.maxScore, p.score),
      level,
      timesFlagged: already ? existing.timesFlagged : existing.timesFlagged + 1,
      places: places.slice(0, 50) as any,
      networks: [...nets].slice(0, 20) as any,
      ...(p.signals ? { signals: p.signals as any } : {}),
      lastSeenAt: new Date()
    }
  });
}

/** Tras un análisis: guarda los perfiles de riesgo medio/alto y las positivas sospechosas de la competencia. */
export async function recordProfiles(workspaceId: string, analysisId: string, res: AnalysisResults) {
  const key = placeKeyOf(res.client.dataId || res.client.placeId, res.client.title);
  const at = new Date().toISOString();
  const netOf = new Map<string, string>();
  for (const n of res.networks ?? []) for (const m of n.members) netOf.set(m, n.id);
  for (const a of res.authors) {
    if (!a.cid || a.level === "bajo") continue;
    await upsertProfile(workspaceId, {
      cid: a.cid,
      name: a.name,
      link: a.link,
      score: a.score,
      level: a.level,
      place: { key, title: res.client.title, analysisId, at, score: a.score, role: "negativa al cliente" },
      signals: a.signals.map((s) => ({ label: s.label, points: s.points })),
      network: netOf.get(a.cid) ? `${analysisId}:${netOf.get(a.cid)}` : undefined
    }).catch(() => undefined);
  }
  for (const cf of res.compFakes ?? []) {
    const comp = res.competitors[cf.comp];
    const ck = comp ? placeKeyOf(comp.dataId || comp.placeId, comp.title) : `t:${cf.title}`;
    for (const r of cf.suspicious) {
      if (!r.contributorId || r.score < 60) continue;
      await upsertProfile(workspaceId, {
        cid: r.contributorId,
        name: r.author,
        link: r.authorLink,
        score: r.score,
        level: r.score >= 75 ? "alto" : "medio",
        place: { key: ck, title: cf.title, analysisId, at, score: r.score, role: "positiva sospechosa" },
        signals: r.reasons.map((x) => ({ label: x, points: 0 }))
      }).catch(() => undefined);
    }
  }
}

/** Google ha retirado una reseña del perfil → pasa a «confirmado». */
export async function markProfileConfirmed(workspaceId: string, contributorId: string) {
  if (!contributorId) return;
  const p = await prisma.gmbReviewerProfile.findUnique({ where: { workspaceId_contributorId: { workspaceId, contributorId } } });
  if (!p) return;
  await prisma.gmbReviewerProfile.updateMany({
    where: { id: p.id, workspaceId },
    data: { status: p.status === "descartado" ? p.status : "confirmado", removedCount: p.removedCount + 1 }
  });
}

/* ───────────────────────── Aprendizaje ───────────────────────── */

export async function getLearningStats(workspaceId: string): Promise<LearningStats> {
  const rows = await prisma.gmbReviewCase.findMany({
    where: { workspaceId },
    select: { status: true, googleOption: true, target: true, channel: true, reasons: true, reportedAt: true, appealedAt: true, removedAt: true },
    take: 5000
  });
  return learningStats(rows.map((r) => ({ ...r, reasons: (r.reasons as CaseReason[] | null) ?? [] })));
}

/* ───────────────────────── Centro de retiradas ───────────────────────── */

export type NewCase = {
  target: "cliente" | "competidor";
  place: Place;
  reviewId: string;
  reviewLink: string;
  author: string;
  authorLink: string;
  contributorId: string;
  rating: number;
  reviewDate: string;
  text: string;
  reasons: CaseReason[];
  score: number;
  likelihood: "alta" | "media" | "baja";
  analysisId?: string;
  watchId?: string;
  source: string;
  evidence?: Record<string, unknown>;
};

const CHECK_AFTER_MS = 3 * 86_400_000;

/** Crea (o actualiza sin tocar el estado) un caso. Devuelve true si es nuevo. */
export async function upsertCase(workspaceId: string, c: NewCase, stats?: LearningStats | null, createdById?: string | null): Promise<{ id: string; created: boolean }> {
  const placeKey = placeKeyOf(c.place.dataId || c.place.placeId, c.place.title);
  const reviewId = c.reviewId || `${c.author}|${c.reviewDate}|${c.rating}`.slice(0, 190);
  const option = pickOption(c.reasons, stats);
  const likelihood = calibratedLikelihood(c.likelihood, option, stats);
  const existing = await prisma.gmbReviewCase.findUnique({ where: { workspaceId_placeKey_reviewId: { workspaceId, placeKey, reviewId } } });
  const base = {
    placeTitle: c.place.title.slice(0, 250),
    placeUrl: c.place.mapsUrl.slice(0, 500),
    reviewLink: c.reviewLink.slice(0, 1000),
    author: c.author.slice(0, 200),
    authorLink: c.authorLink.slice(0, 500),
    contributorId: c.contributorId,
    rating: c.rating,
    reviewDate: c.reviewDate,
    text: c.text.slice(0, 4000)
  };
  if (existing) {
    const merged = [...((existing.reasons as CaseReason[] | null) ?? [])];
    for (const r of c.reasons) if (!merged.some((m) => m.label === r.label && m.detail === r.detail)) merged.push(r);
    await prisma.gmbReviewCase.updateMany({
      where: { id: existing.id, workspaceId },
      data: {
        ...base,
        reasons: merged.slice(0, 20) as any,
        score: Math.max(existing.score, c.score),
        ...(existing.status === "preparada" ? { googleOption: pickOption(merged, stats), likelihood } : {}),
        ...(c.analysisId && !existing.analysisId ? { analysisId: c.analysisId } : {}),
        ...(c.watchId && !existing.watchId ? { watchId: c.watchId } : {})
      }
    });
    return { id: existing.id, created: false };
  }
  const row = await prisma.gmbReviewCase.create({
    data: {
      workspaceId,
      analysisId: c.analysisId ?? null,
      watchId: c.watchId ?? null,
      target: c.target,
      placeKey,
      reviewId,
      ...base,
      reasons: c.reasons.slice(0, 20) as any,
      score: c.score,
      likelihood,
      googleOption: option,
      status: "preparada",
      channel: c.target === "competidor" ? "maps" : "tool",
      reportText: reportText({ ...base, target: c.target, reasons: c.reasons, googleOption: option, placeTitle: c.place.title }),
      nextCheckAt: new Date(Date.now() + CHECK_AFTER_MS),
      createdById: createdById ?? null
    }
  });
  await saveEvidence(workspaceId, row.id, {
    kind: "review",
    source: c.source,
    url: c.reviewLink,
    payload: {
      negocio: { nombre: c.place.title, direccion: c.place.address, ficha: c.place.mapsUrl, id: c.place.dataId || c.place.placeId },
      reseña: { id: c.reviewId, autor: c.author, perfil: c.authorLink, estrellas: c.rating, fecha: c.reviewDate, texto: c.text, enlace: c.reviewLink },
      motivos: c.reasons,
      ...(c.evidence ?? {})
    }
  }).catch(() => undefined);
  return { id: row.id, created: true };
}

/** Tras un análisis: el caso para Google pasa al centro de retiradas (+ positivas falsas de la competencia). */
export async function createCasesFromAnalysis(workspaceId: string, analysisId: string, res: AnalysisResults, createdById?: string | null) {
  const stats = await getLearningStats(workspaceId).catch(() => null);
  const gc = buildGoogleCase(res);
  const authorBy = new Map(res.authors.map((a) => [a.name + "|" + a.link, a]));
  const policyBy = new Map((res.policy?.findings ?? []).map((f) => [f.reviewId || f.link, f]));
  let created = 0;
  for (const r of gc.removals) {
    const pf = policyBy.get(r.reviewId || r.link);
    const author = [...authorBy.values()].find((a) => a.clientReviews.some((x) => (x.reviewId && x.reviewId === r.reviewId) || (x.link && x.link === r.link)));
    const reasons: CaseReason[] = [];
    if (author && author.crossPos > 0 && author.score >= LEVEL_MEDIUM) {
      const comps = author.compReviews
        .filter((c) => c.rating >= res.params.posThreshold)
        .map((c) => `${res.competitors[c.comp ?? 0]?.title ?? c.title ?? "competidor"} (${c.rating}/5, ${c.date})`)
        .join("; ");
      reasons.push({
        kind: "fake",
        category: "fake",
        label: "Perfil vinculado a la competencia",
        policy: FAKE_POLICY,
        detail: `Publicó valoraciones positivas en competidores directos: ${comps}${author.gapDays != null ? ` (${author.gapDays} días entre ambas)` : ""}. Riesgo ${author.score}/100.`
      });
      const net = author.signals.find((s) => s.code === "network");
      if (net) reasons.push({ kind: "network", label: "Red de perfiles coordinados", policy: FAKE_POLICY, detail: `${net.label}${net.detail ? `: ${net.detail}` : ""}` });
      const known = author.signals.find((s) => s.code === "known_profile");
      if (known) reasons.push({ kind: "known", label: "Perfil reincidente", policy: FAKE_POLICY, detail: `${known.label}${known.detail ? `: ${known.detail}` : ""}` });
    }
    if (pf) reasons.push(...reasonsFromPolicy(pf.violations));
    if (!reasons.length) continue;
    const likelihood = pf?.likelihood === "alta" || (author?.score ?? 0) >= 60 ? "alta" : "media";
    const out = await upsertCase(
      workspaceId,
      {
        target: "cliente",
        place: res.client,
        reviewId: r.reviewId,
        reviewLink: r.link,
        author: r.author,
        authorLink: r.authorLink,
        contributorId: author?.cid ?? "",
        rating: r.rating,
        reviewDate: r.date,
        text: r.text,
        reasons,
        score: Math.max(author?.score ?? 0, pf ? (pf.likelihood === "alta" ? 80 : 55) : 0),
        likelihood,
        analysisId,
        source: "analysis",
        evidence: author
          ? { perfil: { nombre: author.name, reseñas: author.totalReviews, localGuide: author.localGuide, señales: author.signals.map((s) => `${s.points > 0 ? "+" : ""}${s.points} ${s.label} ${s.detail}`) }, competencia: author.compReviews }
          : undefined
      },
      stats,
      createdById
    ).catch(() => null);
    if (out?.created) created++;
  }
  for (const cf of res.compFakes ?? []) {
    const comp = res.competitors[cf.comp];
    if (!comp) continue;
    for (const r of cf.suspicious) {
      if (r.score < 60) continue;
      const out = await upsertCase(
        workspaceId,
        {
          target: "competidor",
          place: comp,
          reviewId: r.reviewId,
          reviewLink: r.link,
          author: r.author,
          authorLink: r.authorLink,
          contributorId: r.contributorId,
          rating: r.rating,
          reviewDate: r.date,
          text: r.text,
          reasons: [{ kind: "competitor", label: "Positiva sospechosa en la competencia", policy: FAKE_POLICY, detail: r.reasons.join("; ") }],
          score: r.score,
          likelihood: r.score >= 80 ? "alta" : "media",
          analysisId,
          source: "analysis"
        },
        stats,
        createdById
      ).catch(() => null);
      if (out?.created) created++;
    }
  }
  return created;
}

/** Lo que hay que hacer al terminar un análisis (tolerante a fallos). */
export async function afterAnalysis(workspaceId: string, analysisId: string, res: AnalysisResults, createdById?: string | null) {
  try {
    await recordProfiles(workspaceId, analysisId, res);
  } catch (e) {
    console.warn("[fake-reviews] perfiles", (e as Error).message);
  }
  try {
    return await createCasesFromAnalysis(workspaceId, analysisId, res, createdById);
  } catch (e) {
    console.warn("[fake-reviews] casos", (e as Error).message);
    return 0;
  }
}

/* ───────────────────────── API oficial de Google ───────────────────────── */

/** Ficha del hub conectada a Google para este lugar (por Place ID o nombre), si la hay. */
export async function managedLocationFor(workspaceId: string, place: Place, gmbClientId?: string | null): Promise<string | null> {
  const conn = await prisma.gmbGoogleConnection.findUnique({ where: { workspaceId }, select: { revokedAt: true, hasBusinessScope: true } }).catch(() => null);
  if (!conn || conn.revokedAt) return null;
  const where = gmbClientId
    ? { id: gmbClientId, workspaceId }
    : place.placeId
      ? { workspaceId, placeId: place.placeId }
      : null;
  if (!where) return null;
  const c = await prisma.gmbClient.findFirst({ where, select: { accountId: true, locationId: true } });
  return c ? gmbLocationPath(c.accountId, c.locationId) : null;
}

/** Reseñas de una ficha propia por la API oficial, en el formato del detector (sin id de autor). */
export async function officialReviews(workspaceId: string, locationPath: string, maxPages = 20) {
  const list = await gmbListAllReviews({ workspaceId, locationPath, maxPages });
  return list.map((r) => {
    const ts = r.createTime ? Math.floor(Date.parse(r.createTime) / 1000) : 0;
    return {
      reviewId: `gbp:${r.reviewId}`,
      gbpName: r.reviewName,
      rating: r.rating,
      ts,
      date: ts ? new Date(ts * 1000).toISOString().slice(0, 10) : "",
      text: r.comment ?? "",
      photos: 0,
      link: "",
      replied: !!r.reply,
      user: { name: r.reviewer, contributorId: "", link: "", thumbnail: r.profilePhotoUrl, localGuide: false, reviews: 0, photos: 0 }
    };
  });
}

export { GOOGLE_OPTIONS };
