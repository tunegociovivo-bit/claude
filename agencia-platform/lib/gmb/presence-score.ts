/**
 * Local Presence Score (0–100) — puro y determinista.
 *
 * Seis dimensiones ponderadas: perfil, reseñas, contenido, citaciones, ranking y web. Cada una se
 * calcula 0–100 a partir de datos REALES de la ficha (nunca inventados) y se combina por pesos.
 * Se usa en el Dashboard "Presencia local" y para snapshots de evolución. Sin red, sin efectos.
 */

export type PresenceInput = {
  profile: { hasDescription: boolean; hasCategory: boolean; hasPhone: boolean; hasWebsite: boolean; hasAddress: boolean; hasHours: boolean; photoCount: number };
  reviews: { count: number; avgRating: number; responseRate: number }; // responseRate 0..1
  content: { postsLast30: number; photoCount: number };
  citations: { total: number; published: number; consistent: number };
  ranking: { keywordsTracked: number; avgTop3Share: number }; // avgTop3Share 0..1
  web: { hasWebsite: boolean; hasSchema: boolean };
};

export type PresenceBreakdown = { profile: number; reviews: number; content: number; citations: number; ranking: number; web: number };

// Pesos por dimensión (suman 100). Reseñas y perfil pesan más (impacto local directo).
export const PRESENCE_WEIGHTS: PresenceBreakdown = { profile: 20, reviews: 25, content: 15, citations: 15, ranking: 15, web: 10 };

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

function scoreProfile(p: PresenceInput["profile"]): number {
  // 6 señales booleanas (60%) + fotos hasta 8 (40%).
  const bools = [p.hasDescription, p.hasCategory, p.hasPhone, p.hasWebsite, p.hasAddress, p.hasHours].filter(Boolean).length;
  const photoScore = Math.min(p.photoCount, 8) / 8;
  return clamp((bools / 6) * 60 + photoScore * 40);
}

function scoreReviews(r: PresenceInput["reviews"]): number {
  if (r.count <= 0) return 0;
  // Volumen (hasta 50 reseñas → 40%), nota media /5 (40%), tasa de respuesta (20%).
  const volume = Math.min(r.count, 50) / 50;
  const rating = Math.max(0, Math.min(r.avgRating, 5)) / 5;
  const resp = Math.max(0, Math.min(r.responseRate, 1));
  return clamp(volume * 40 + rating * 40 + resp * 20);
}

function scoreContent(c: PresenceInput["content"]): number {
  // Cadencia de posts (4/mes = pleno, 60%) + fotos recientes (hasta 12, 40%).
  const posts = Math.min(c.postsLast30, 4) / 4;
  const photos = Math.min(c.photoCount, 12) / 12;
  return clamp(posts * 60 + photos * 40);
}

function scoreCitations(c: PresenceInput["citations"]): number {
  if (c.total <= 0) return 0;
  // Publicadas (50%) + consistentes sobre publicadas (50%).
  const published = c.published / c.total;
  const consistent = c.published > 0 ? c.consistent / c.published : 0;
  return clamp(published * 50 + consistent * 50);
}

function scoreRanking(r: PresenceInput["ranking"]): number {
  if (r.keywordsTracked <= 0) return 0; // "sin conectar" → 0 honesto, no inventamos posiciones
  return clamp(Math.max(0, Math.min(r.avgTop3Share, 1)) * 100);
}

function scoreWeb(w: PresenceInput["web"]): number {
  return clamp((w.hasWebsite ? 60 : 0) + (w.hasSchema ? 40 : 0));
}

export function computePresenceScore(input: PresenceInput): { total: number; breakdown: PresenceBreakdown; weights: PresenceBreakdown } {
  const breakdown: PresenceBreakdown = {
    profile: scoreProfile(input.profile),
    reviews: scoreReviews(input.reviews),
    content: scoreContent(input.content),
    citations: scoreCitations(input.citations),
    ranking: scoreRanking(input.ranking),
    web: scoreWeb(input.web)
  };
  const total = clamp(
    (Object.keys(PRESENCE_WEIGHTS) as (keyof PresenceBreakdown)[]).reduce(
      (sum, k) => sum + (breakdown[k] * PRESENCE_WEIGHTS[k]) / 100,
      0
    )
  );
  return { total, breakdown, weights: PRESENCE_WEIGHTS };
}
