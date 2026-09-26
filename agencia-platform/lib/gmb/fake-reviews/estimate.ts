/**
 * Coste estimado antes de lanzar (lógica pura, se usa en la UI y en el servidor).
 * Búsquedas de SerpApi/Serper y llamadas a la IA, con su equivalencia aproximada en euros.
 */
export type EstimateInput = {
  provider: "serpapi" | "serper" | null;
  kind: "cruce" | "policy";
  mode: "manual" | "auto";
  client: { reviews: number | null; rating: number | null };
  comps: { reviews: number | null }[];
  negThreshold: number;
  dateFrom: string;
  deep: boolean;
  maxDeep: number;
  policy: boolean;
  ai: boolean;
  compFakes?: boolean;
};

export type Estimate = { min: number; max: number; ai: number; eurMin: number; eurMax: number; lines: { label: string; n: string }[] };

/** Precio orientativo por búsqueda (plan Developer de SerpApi ≈ 75 $ / 5.000; Serper ≈ 1 $ / 1.000). */
export const PRICE_EUR = { serpapi: 0.014, serper: 0.001, ai: 0.02 };

const pages = (n: number) => (n <= 8 ? 1 : 1 + Math.ceil((n - 8) / 20));

export function negativeShare(rating: number | null, negThreshold: number): number {
  const base = negThreshold === 1 ? 0.07 : negThreshold === 2 ? 0.11 : 0.16;
  const r = rating ?? 4.2;
  const f = r <= 3 ? 3 : r <= 3.6 ? 2.2 : r <= 4.1 ? 1.4 : r >= 4.7 ? 0.4 : r >= 4.5 ? 0.6 : 1;
  return Math.min(0.7, base * f);
}

export function estimateAnalysis(i: EstimateInput): Estimate {
  const lines: { label: string; n: string }[] = [];
  let frac = 1;
  if (i.dateFrom) {
    const months = (Date.now() - Date.parse(i.dateFrom)) / 2.63e9;
    frac = Math.min(1, Math.max(0.15, months / 48));
  }
  const negAll = Math.max(3, Math.round((i.client.reviews ?? 100) * negativeShare(i.client.rating, i.negThreshold)));
  const neg = Math.max(3, Math.round(negAll * frac));
  const history = i.provider === "serpapi";
  let min = 0;
  let max = 0;
  const add = (label: string, a: number, b = a) => {
    min += a;
    max += b;
    lines.push({ label, n: a === b ? `${a}` : `${a}–${b}` });
  };
  add(`Negativas del cliente (≈ ${neg})`, pages(neg), Math.min(15, pages(Math.round(neg * 1.6))));
  if (i.kind === "cruce") {
    if (i.mode === "auto") {
      if (history) {
        const prof = Math.min(i.maxDeep, neg);
        add("Historial de cada perfil", Math.round(prof * 0.8), prof);
        add("Fichas de la competencia detectada", 0, 5);
        if (i.compFakes !== false) add("Positivas recientes de la competencia", 0, 10);
      } else {
        add("Barrido de competencia cercana (8 negocios)", 1 + 8 * 3, 1 + 8 * 6);
      }
    } else {
      for (const [k, c] of i.comps.entries()) {
        const n = pages(Math.round((c.reviews ?? 100) * frac));
        add(`Competidor ${k + 1}`, Math.min(25, Math.max(1, Math.round(n * 0.6))), Math.min(25, n));
      }
      if (i.deep && history) {
        const prof = Math.min(i.maxDeep, neg);
        add("Historial de cada perfil", Math.round(prof * 0.8), prof);
      }
    }
  }
  let ai = 0;
  const withText = Math.round(neg * 0.8);
  if (i.kind === "policy" || i.policy) ai += Math.max(1, Math.ceil(withText / 20));
  if (i.ai) ai += 1;
  if (ai) lines.push({ label: "Llamadas a la IA", n: `${ai}` });
  const unit = i.provider === "serper" ? PRICE_EUR.serper : PRICE_EUR.serpapi;
  return {
    min,
    max,
    ai,
    eurMin: Math.round((min * unit + ai * PRICE_EUR.ai) * 100) / 100,
    eurMax: Math.round((max * unit + ai * PRICE_EUR.ai) * 100) / 100,
    lines
  };
}

/** Consumo mensual aproximado de una vigilancia. */
export function estimateWatch(i: { provider: "serpapi" | "serper" | null; gbp: boolean; frequencyHours: number; competitors: number; deepCheck: boolean; negPerMonth?: number }) {
  const runs = Math.round((30 * 24) / Math.max(1, i.frequencyHours));
  const base = i.gbp ? 0 : runs;
  const neg = i.negPerMonth ?? 4;
  const deep = i.deepCheck && i.provider === "serpapi" ? neg * (i.gbp ? 2 : 1) : 0;
  const comp = i.competitors * 6; // revisión semanal: 1-2 búsquedas por competidor
  const verify = 10; // comprobaciones de reseñas denunciadas
  const total = base + deep + comp + verify;
  const unit = i.provider === "serper" ? PRICE_EUR.serper : PRICE_EUR.serpapi;
  return { searches: total, eur: Math.round((total * unit + neg * PRICE_EUR.ai) * 100) / 100, runs };
}
