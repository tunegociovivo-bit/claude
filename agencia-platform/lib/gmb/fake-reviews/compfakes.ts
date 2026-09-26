/**
 * Positivas sospechosas en la competencia (lógica pura).
 *
 * Además de defender al cliente, detecta reseñas de 5★ que un competidor podría estar comprando o
 * generando: picos de volumen anómalos, cuentas de 1-2 reseñas, textos vacíos o genéricos, perfiles
 * que también atacaron al cliente, perfiles ya fichados o que forman parte de una red. Google
 * prohíbe expresamente los picos anómalos y las reseñas de varias cuentas dirigidas por una persona.
 */
import { DAY, tsDate, type Place, type Review } from "./core";
import type { Network } from "./network";

export type KnownProfile = { timesFlagged: number; status: string; maxScore: number; places: string[] };

export type CompFakeReview = {
  reviewId: string;
  author: string;
  authorLink: string;
  contributorId: string;
  rating: number;
  date: string;
  text: string;
  link: string;
  score: number;
  reasons: string[];
};

export type CompFake = {
  comp: number;
  title: string;
  reviewsRead: number;
  positives: number;
  spikes: { week: string; count: number; baseline: number }[];
  suspicious: CompFakeReview[];
};

const GENERIC = /^(muy (bueno|buena|bien|recomendable)|excelente|genial|perfecto|todo (bien|perfecto)|recomendable|lo recomiendo|100%? ?recomendable|super|top|great|good|excellent|very good|amazing|nice|ok|bien)[.!\s]*$/i;

function weekKey(ts: number): string {
  const d = new Date(ts * 1000);
  const day = (d.getUTCDay() + 6) % 7; // lunes = 0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Semanas con un número anómalo de positivas respecto a la mediana de las últimas 26 semanas. */
export function detectSpikes(positives: { ts: number }[], opts: { minCount?: number; factor?: number } = {}) {
  const dated = positives.filter((p) => p.ts);
  if (!dated.length) return [];
  const last = Math.max(...dated.map((p) => p.ts));
  const counts = new Map<string, number>();
  for (let i = 0; i < 26; i++) counts.set(weekKey(last - i * 7 * DAY), 0);
  for (const p of dated) {
    const k = weekKey(p.ts);
    if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const base = median([...counts.values()]);
  const min = opts.minCount ?? 5;
  const factor = opts.factor ?? 3;
  return [...counts.entries()]
    .filter(([, n]) => n >= min && n >= factor * base + 2)
    .map(([week, count]) => ({ week, count, baseline: Math.round(base * 10) / 10 }))
    .sort((a, b) => b.week.localeCompare(a.week));
}

export function analyzeCompetitorPositives(
  comps: Place[],
  compReviews: Review[][],
  opts: {
    posThreshold: number;
    clientNegAuthors: Set<string>;
    known?: Record<string, KnownProfile>;
    networks?: Map<string, Network>;
    minScore?: number;
  }
): CompFake[] {
  const out: CompFake[] = [];
  comps.forEach((c, ci) => {
    const list = compReviews[ci] ?? [];
    const pos = list.filter((r) => r.rating >= opts.posThreshold);
    const spikes = detectSpikes(pos);
    const spikeWeeks = new Set(spikes.map((s) => s.week));
    const sus: CompFakeReview[] = [];
    for (const r of pos) {
      const reasons: string[] = [];
      let score = 0;
      const total = r.user.reviews;
      const cid = r.user.contributorId;
      if (total > 0 && total <= 2) {
        score += 30;
        reasons.push(`Perfil con sólo ${total} reseña(s)`);
      } else if (total > 0 && total <= 5) {
        score += 15;
        reasons.push(`Perfil con poca actividad (${total} reseñas)`);
      }
      const t = r.text.trim();
      if (!t) {
        score += 10;
        reasons.push("Sin texto (sólo estrellas)");
      } else if (t.length < 30 && GENERIC.test(t)) {
        score += 8;
        reasons.push("Texto genérico muy corto");
      }
      if (r.ts && spikeWeeks.has(weekKey(r.ts))) {
        score += 20;
        reasons.push(`Publicada en una semana con un pico anómalo de valoraciones positivas`);
      }
      if (cid && opts.clientNegAuthors.has(cid)) {
        score += 30;
        reasons.push("El mismo perfil dejó una reseña negativa al cliente");
      }
      const k = cid ? opts.known?.[cid] : undefined;
      if (k && k.status !== "descartado") {
        score += k.status === "confirmado" ? 30 : 20;
        reasons.push(k.status === "confirmado" ? "Perfil con reseñas ya retiradas por Google" : `Perfil ya marcado como sospechoso (${k.timesFlagged} vez/veces)`);
      }
      const net = cid ? opts.networks?.get(cid) : undefined;
      if (net) {
        score += 20;
        reasons.push(`Forma parte de la red ${net.id} (${net.members.length} perfiles coordinados)`);
      }
      if (r.user.localGuide && total >= 50) {
        score -= 25;
        reasons.push(`Local Guide con ${total} reseñas (más creíble)`);
      }
      if (r.photos > 0) {
        score -= 10;
        reasons.push("Incluye fotos propias");
      }
      if (score >= (opts.minScore ?? 50)) {
        sus.push({
          reviewId: r.reviewId,
          author: r.user.name,
          authorLink: r.user.link,
          contributorId: cid,
          rating: r.rating,
          date: r.date || tsDate(r.ts),
          text: r.text.slice(0, 300),
          link: r.link,
          score: Math.min(100, score),
          reasons
        });
      }
    }
    sus.sort((a, b) => b.score - a.score);
    if (spikes.length || sus.length) {
      out.push({ comp: ci, title: c.title, reviewsRead: list.length, positives: pos.length, spikes: spikes.slice(0, 6), suspicious: sus.slice(0, 40) });
    }
  });
  return out;
}
