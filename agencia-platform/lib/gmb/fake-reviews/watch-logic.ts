/**
 * Vigilancia diaria — lógica pura: reseñas nuevas, detección de ataques y picos en la competencia.
 */
import { DAY, type Review } from "./core";
import { norm } from "./analyzer";
import { detectSpikes } from "./compfakes";

export type WatchHistoryEntry = { d: string; rating: number | null; reviews: number | null; newReviews: number; newNeg: number; flagged: number };

export const reviewKey = (r: { reviewId?: string; user?: { name: string }; author?: string; date?: string; rating: number }) =>
  r.reviewId || `${norm(r.user?.name ?? r.author ?? "")}|${r.date ?? ""}|${r.rating}`;

/** Reseñas que no estaban en la memoria de la vigilancia. */
export function newReviews(known: string[], reviews: Review[]): Review[] {
  const set = new Set(known);
  return reviews.filter((r) => !set.has(reviewKey(r)));
}

export function mergeKnown(known: string[], reviews: Review[], max = 500): string[] {
  const out = [...reviews.map(reviewKey), ...known];
  return [...new Set(out)].slice(0, max);
}

/**
 * ¿Ataque de reseñas? ≥ 3 negativas en 72 h y al menos 3× lo habitual (media de los 90 días previos).
 */
export function attackCheck(negTs: number[], now = Math.floor(Date.now() / 1000)) {
  const w = 3 * DAY;
  const recent = negTs.filter((t) => t && t > now - w && t <= now + DAY).length;
  const prev = negTs.filter((t) => t && t <= now - w && t > now - 93 * DAY).length;
  const baseline = Math.round((prev / 30) * 100) / 100; // negativas por cada 3 días
  return { recent, baseline, attack: recent >= 3 && recent >= 3 * baseline + 1 };
}

/** Pico de positivas en la competencia en la última o penúltima semana. */
export function recentSpike(posTs: number[], now = Math.floor(Date.now() / 1000)) {
  const spikes = detectSpikes(posTs.map((ts) => ({ ts })));
  return spikes.find((s) => Date.parse(s.week) / 1000 >= now - 14 * DAY) ?? null;
}

export function pushHistory(h: WatchHistoryEntry[], e: WatchHistoryEntry, max = 400): WatchHistoryEntry[] {
  const rest = h.filter((x) => x.d !== e.d);
  const prev = h.find((x) => x.d === e.d);
  const merged = prev ? { ...e, newReviews: prev.newReviews + e.newReviews, newNeg: prev.newNeg + e.newNeg, flagged: prev.flagged + e.flagged } : e;
  return [...rest, merged].sort((a, b) => a.d.localeCompare(b.d)).slice(-max);
}
