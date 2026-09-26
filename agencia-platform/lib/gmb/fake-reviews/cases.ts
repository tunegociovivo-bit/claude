/**
 * Centro de retiradas — acciones con BD: verificación automática de si Google ha retirado la
 * reseña, apelaciones en lotes de 10 redactadas con IA, vía legal y respuestas públicas sugeridas.
 */
import { prisma } from "@/lib/db/prisma";
import { complete } from "@/lib/ai/anthropic";
import { gmbListAllReviews, gmbReplyReview } from "@/lib/integrations/gmb";
import type { ReviewSource } from "@/lib/integrations/serpapi";
import { getReviewSource } from "./provider";
import { nextToken, normalizeReview, type Review } from "./core";
import { norm } from "./analyzer";
import {
  GOOGLE_OPTIONS,
  OPEN_STATUSES,
  STATUS_LABEL,
  appealTemplate,
  findReview,
  legalTemplate,
  type CaseLike,
  type CaseReason,
  type LearningStats,
  type SeenReview
} from "./cases-logic";
import { getLearningStats, managedLocationFor, markProfileConfirmed, saveEvidence } from "./shield";
import { notifyChannels, raiseAlert, type ShieldAlert } from "./notify";

type CaseRow = Awaited<ReturnType<typeof prisma.gmbReviewCase.findFirst>> & {};

export const caseLike = (c: NonNullable<CaseRow>): CaseLike => ({
  target: c.target,
  placeTitle: c.placeTitle,
  placeUrl: c.placeUrl,
  author: c.author,
  authorLink: c.authorLink,
  rating: c.rating,
  reviewDate: c.reviewDate,
  text: c.text,
  reviewLink: c.reviewLink,
  reasons: (c.reasons as CaseReason[] | null) ?? [],
  googleOption: c.googleOption,
  score: c.score
});

/* ───────────────────────── Verificación ───────────────────────── */

const DAY_MS = 86_400_000;

function placeIdFromKey(key: string): { data_id?: string; place_id?: string } | null {
  if (/^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(key)) return { data_id: key };
  if (/^(ChIJ|GhIJ|EhI)/.test(key)) return { place_id: key };
  return null;
}

/** Lee las reseñas bajas de una ficha (ordenadas de peor a mejor) hasta superar `maxRating`. */
async function lowReviews(api: ReviewSource, id: { data_id?: string; place_id?: string }, maxRating: number, maxPages = 5): Promise<SeenReview[]> {
  const out: SeenReview[] = [];
  let token = "";
  for (let i = 0; i < maxPages; i++) {
    const d = await api.reviews(id, maxRating >= 4 ? "newestFirst" : "ratingLow", token || undefined);
    let stop = false;
    for (const raw of d.reviews ?? []) {
      const r: Review = normalizeReview(raw);
      if (maxRating < 4 && r.rating > maxRating) stop = true;
      out.push({ reviewId: r.reviewId, author: r.user.name, rating: r.rating, date: r.date, ts: r.ts, text: r.text });
    }
    token = nextToken(d);
    if (stop || !token) break;
  }
  return out;
}

/**
 * Comprueba si siguen publicadas las reseñas denunciadas/apeladas. Dos comprobaciones seguidas sin
 * encontrarla → «retirada» (con prueba fechada), el perfil pasa a «confirmado» y se avisa.
 */
export async function verifyDueCases(maxPlaces = 3) {
  const due = await prisma.gmbReviewCase.findMany({
    where: { status: { in: OPEN_STATUSES }, OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: new Date() } }] },
    orderBy: { nextCheckAt: "asc" },
    take: 200
  });
  const groups = new Map<string, typeof due>();
  for (const c of due) {
    const k = `${c.workspaceId}|${c.placeKey}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  let done = 0;
  for (const [k, cases] of groups) {
    if (done++ >= maxPlaces) break;
    const [workspaceId, placeKey] = k.split("|");
    await verifyPlace(workspaceId, placeKey, cases).catch((e) => console.warn("[escudo] verificar", placeKey, (e as Error).message));
  }
}

export async function verifyPlace(workspaceId: string, placeKey: string, cases: NonNullable<CaseRow>[]) {
  const now = new Date();
  let seen: SeenReview[] | null = null;
  let source = "";
  // Ficha propia conectada → API oficial (gratis y exacta).
  const pid = placeIdFromKey(placeKey);
  if (pid?.place_id) {
    const loc = await managedLocationFor(workspaceId, { placeId: pid.place_id } as any).catch(() => null);
    if (loc) {
      try {
        const list = await gmbListAllReviews({ workspaceId, locationPath: loc, maxPages: 40 });
        seen = list.map((r) => ({ reviewId: `gbp:${r.reviewId}`, author: r.reviewer, rating: r.rating, date: r.createTime?.slice(0, 10), text: r.comment ?? "" }));
        source = "gbp";
      } catch {
        seen = null;
      }
    }
  }
  if (!seen) {
    if (!pid) {
      // Sin identificador de Google no se puede comprobar: se revisa a mano.
      await prisma.gmbReviewCase.updateMany({ where: { workspaceId, id: { in: cases.map((c) => c.id) } }, data: { nextCheckAt: new Date(now.getTime() + 7 * DAY_MS) } });
      return;
    }
    const api = await getReviewSource(workspaceId, { cacheDays: 0 });
    const maxRating = Math.max(...cases.map((c) => c.rating));
    seen = await lowReviews(api, pid, maxRating);
    source = api.provider;
  }

  const alerts: ShieldAlert[] = [];
  for (const c of cases) {
    const found = findReview({ reviewId: c.reviewId, author: c.author, rating: c.rating, reviewDate: c.reviewDate, text: c.text }, seen);
    const log = [{ at: now.toISOString(), found, source }, ...(((c.checkLog as any[]) ?? []).slice(0, 19))];
    if (found) {
      const hot = c.status === "denunciada" || c.status === "apelada";
      await prisma.gmbReviewCase.updateMany({
        where: { id: c.id, workspaceId },
        data: { checkMisses: 0, lastCheckedAt: now, checkLog: log as any, nextCheckAt: new Date(now.getTime() + (hot ? 2 : 7) * DAY_MS) }
      });
      // Denunciada hace > 10 días y sigue publicada → toca apelar.
      if (c.status === "denunciada" && c.reportedAt && now.getTime() - c.reportedAt.getTime() > 10 * DAY_MS) {
        alerts.push({
          type: "review_appeal_due",
          severity: "info",
          title: `Sigue publicada: reseña de «${c.author}» en ${c.placeTitle}`,
          body: "Han pasado más de 10 días desde la denuncia. Si Google la rechazó, márcala como rechazada: la apelación ya está preparada.",
          dedupKey: `rc-appeal:${c.id}`
        });
      }
      continue;
    }
    const misses = c.checkMisses + 1;
    if (misses >= 2) {
      await prisma.gmbReviewCase.updateMany({
        where: { id: c.id, workspaceId },
        data: { status: "retirada", removedAt: now, checkMisses: misses, lastCheckedAt: now, checkLog: log as any, nextCheckAt: null }
      });
      await saveEvidence(workspaceId, c.id, { kind: "check", source, url: c.reviewLink, payload: { resultado: "La reseña ya no aparece en la ficha", comprobaciones: log.slice(0, 3) } }).catch(() => undefined);
      await markProfileConfirmed(workspaceId, c.contributorId).catch(() => undefined);
      alerts.push({
        type: "review_removed",
        severity: "info",
        title: `Google ha retirado la reseña de «${c.author}» en ${c.placeTitle}`,
        body: `${c.rating}★ del ${c.reviewDate.split("-").reverse().join("/")}. Motivo denunciado: ${GOOGLE_OPTIONS[c.googleOption as keyof typeof GOOGLE_OPTIONS] ?? c.googleOption}.`,
        dedupKey: `rc-removed:${c.id}`,
        data: { caseId: c.id }
      });
    } else {
      // Posible retirada: se confirma al día siguiente (evita falsos positivos por paginación).
      await prisma.gmbReviewCase.updateMany({
        where: { id: c.id, workspaceId },
        data: { checkMisses: misses, lastCheckedAt: now, checkLog: log as any, nextCheckAt: new Date(now.getTime() + DAY_MS) }
      });
    }
  }
  const created: ShieldAlert[] = [];
  for (const a of alerts) if (await raiseAlert(workspaceId, a).catch(() => false)) created.push(a);
  if (created.some((a) => a.type === "review_removed")) {
    // Aviso al canal de la vigilancia de esa ficha, si existe.
    const watchId = cases.find((c) => c.watchId)?.watchId;
    const w = watchId ? await prisma.gmbReviewWatch.findFirst({ where: { id: watchId, workspaceId }, select: { name: true, emails: true, whatsapp: true } }) : null;
    if (w) await notifyChannels(workspaceId, w, created.filter((a) => a.type === "review_removed"));
  }
}

/* ───────────────────────── Textos con IA ───────────────────────── */

const APPEAL_SYSTEM = `Eres responsable de reputación online de una agencia de marketing. Redactas en español apelaciones dirigidas al equipo de asistencia del Perfil de Empresa de Google para que vuelva a revisar reseñas que Google no retiró en la primera denuncia.
Reglas:
- Tono formal, respetuoso y factual. Nunca acuses a nadie con nombre propio de haber encargado las reseñas; usa lenguaje de indicios ("patrón compatible con", "indicios de").
- Para cada reseña: identifícala (autor, estrellas, fecha, enlace), cita la política de Google que incumple y aporta la evidencia concreta que el revisor NO vio en la denuncia inicial (vínculos con la competencia, red de perfiles, perfil reincidente, fragmentos textuales que incumplen la política).
- Prioriza los motivos con mejor tasa histórica de retirada si se indican.
- Máximo ~700 palabras. Texto plano, sin markdown. Empieza por "Asunto:" y termina con la firma indicada.`;

export async function appealText(workspaceId: string, userId: string | null, cases: NonNullable<CaseRow>[], signer: string, stats?: LearningStats | null): Promise<string> {
  const business = { name: cases[0]?.placeTitle ?? "", url: cases[0]?.placeUrl };
  const fallback = appealTemplate(cases.map(caseLike), business, signer);
  const best = stats
    ? Object.entries(stats.byOption)
        .filter(([, b]) => b && b.decided >= 3)
        .sort((a, b) => (b[1]?.rate ?? 0) - (a[1]?.rate ?? 0))
        .map(([k, b]) => `${GOOGLE_OPTIONS[k as keyof typeof GOOGLE_OPTIONS] ?? k}: ${Math.round((b?.rate ?? 0) * 100)}% (${b?.decided} casos)`)
    : [];
  try {
    const t = await complete({
      workspaceId,
      userId,
      feature: "gmb_review_appeal",
      maxTokens: 2500,
      system: APPEAL_SYSTEM,
      user: `Negocio: ${business.name}${business.url ? ` (${business.url})` : ""}\nFirma: ${signer}\n${best.length ? `Tasa histórica de retirada por motivo: ${best.join("; ")}\n` : ""}Reseñas (JSON):\n${JSON.stringify(
        cases.map((c) => ({ autor: c.author, perfil: c.authorLink, estrellas: c.rating, fecha: c.reviewDate, enlace: c.reviewLink, texto: (c.text ?? "").slice(0, 600), motivos: c.reasons, opcion_denunciada: GOOGLE_OPTIONS[c.googleOption as keyof typeof GOOGLE_OPTIONS] ?? c.googleOption }))
      )}`
    });
    return t.trim() || fallback;
  } catch {
    return fallback;
  }
}

export function legalText(c: NonNullable<CaseRow>, signer: string) {
  return legalTemplate(caseLike(c), { name: c.placeTitle }, signer);
}

const REPLY_SYSTEM = `Redactas en español la RESPUESTA PÚBLICA del propietario de un negocio a una reseña negativa de Google que probablemente no es auténtica o incumple las políticas.
Reglas: 40-90 palabras; tono sereno, profesional y cordial; no acuses al autor de mentir ni menciones a la competencia; indica que no consta la visita/pedido si procede ("no hemos encontrado ningún registro…"), invita a contactar por un canal privado para aclararlo y reafirma el compromiso con los clientes. Sin emojis, sin firmas largas. Solo el texto de la respuesta.`;

export async function replyDraft(workspaceId: string, userId: string | null, c: NonNullable<CaseRow>): Promise<string> {
  try {
    const t = await complete({
      workspaceId,
      userId,
      feature: "gmb_review_reply_shield",
      maxTokens: 400,
      system: REPLY_SYSTEM,
      user: `Negocio: ${c.placeTitle}\nReseña de ${c.author} (${c.rating}/5, ${c.reviewDate}): «${(c.text ?? "").slice(0, 1200) || "(sin texto)"}»\nIndicios internos (no mencionar): ${((c.reasons as CaseReason[] | null) ?? []).map((r) => r.label).join(", ")}`
    });
    return t.trim();
  } catch {
    return `Hola, ${c.author || "gracias por tu comentario"}. Lamentamos lo que describes, pero no hemos encontrado ningún registro que nos permita identificar tu visita. Nos gustaría aclararlo contigo: escríbenos por privado y lo revisamos personalmente. Cuidar la experiencia de cada cliente es nuestra prioridad.`;
  }
}

/** Publica la respuesta en Google si la ficha es propia y está conectada (busca la reseña por autor y fecha). */
export async function publishReply(workspaceId: string, c: NonNullable<CaseRow>, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const pid = placeIdFromKey(c.placeKey);
  const loc = pid?.place_id ? await managedLocationFor(workspaceId, { placeId: pid.place_id } as any).catch(() => null) : null;
  if (!loc) return { ok: false, error: "Esta ficha no está conectada al hub con Google: copia la respuesta y publícala desde el Perfil de Empresa." };
  const list = await gmbListAllReviews({ workspaceId, locationPath: loc, maxPages: 40 });
  const a = norm(c.author);
  const t0 = c.reviewDate ? Date.parse(c.reviewDate) : 0;
  const match = list.find((r) => norm(r.reviewer) === a && r.rating === c.rating && (!t0 || Math.abs(Date.parse(r.createTime) - t0) <= 3 * DAY_MS));
  if (!match) return { ok: false, error: "No se ha encontrado la reseña en la API de Google (puede que ya no exista)." };
  await gmbReplyReview({ workspaceId, reviewName: match.reviewName, comment: text });
  return { ok: true };
}

export { STATUS_LABEL, getLearningStats };
