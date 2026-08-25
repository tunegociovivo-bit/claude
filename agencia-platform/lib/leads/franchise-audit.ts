export type FranchiseLocationInput = {
  name?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
  website?: string | null;
  phone?: string | null;
  internationalPhone?: string | null;
  businessStatus?: string | null;
};

export type FranchiseFinding = {
  key: string;
  severity: "high" | "medium" | "low";
  title: string;
  evidence: string;
  affectedPct: number;
};

export type FranchiseAudit = {
  version: 2;
  brand: string;
  generatedAt: string;
  methodology: string;
  score: number;
  risk: "critical" | "high" | "medium" | "low";
  metrics: {
    sampled: number;
    avgRating: number | null;
    minRating: number | null;
    maxRating: number | null;
    ratingSpread: number | null;
    ratingStdDev: number | null;
    lowRatingPct: number;
    noWebsitePct: number;
    noPhonePct: number;
    lowReviewsPct: number;
    closedPct: number;
    domainMismatchPct: number;
    reviewsMin: number;
    reviewsMax: number;
    reviewConcentrationPct: number;
  };
  findings: FranchiseFinding[];
  offer: FranchiseOffer;
};

export type FranchiseOffer = {
  key: "network_recovery" | "reputation_control" | "data_integrity" | "visibility_growth";
  title: string;
  promise: string;
  pilot: string;
};

const round = (value: number, digits = 0) => {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
};

const percentage = (count: number, total: number) => total ? Math.round((count / total) * 100) : 0;

function hostname(value?: string | null): string | null {
  if (!value) return null;
  try { return new URL(value).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return null; }
}

function domainMatches(host: string | null, official: string | null): boolean {
  if (!host || !official) return true;
  const normalized = official.replace(/^www\./, "").toLowerCase();
  return host === normalized || host.endsWith(`.${normalized}`);
}

export function selectFranchiseOffer(audit: Pick<FranchiseAudit, "metrics">): FranchiseOffer {
  const m = audit.metrics;
  if (m.lowRatingPct >= 25 || (m.ratingSpread ?? 0) >= 1.2 || m.closedPct >= 10) {
    return {
      key: "network_recovery",
      title: "Programa de recuperación de unidades",
      promise: "Reducir la desigualdad visible entre establecimientos y recuperar las unidades con mayor riesgo.",
      pilot: "Piloto de 60 días sobre tres unidades prioritarias y una unidad de control."
    };
  }
  if (m.noWebsitePct + m.noPhonePct + m.domainMismatchPct >= 30) {
    return {
      key: "data_integrity",
      title: "Control central de presencia local",
      promise: "Corregir datos incoherentes y proteger la experiencia digital de toda la red.",
      pilot: "Corrección verificable de diez ubicaciones y cuadro de control central."
    };
  }
  if (m.lowReviewsPct >= 25) {
    return {
      key: "visibility_growth",
      title: "Activación de visibilidad local",
      promise: "Elevar la señal local de las unidades invisibles sin perder el control de marca.",
      pilot: "Comparativa durante 60 días entre unidades activadas y grupo de control."
    };
  }
  return {
    key: "reputation_control",
    title: "Control de reputación de red",
    promise: "Detectar desviaciones locales antes de que afecten a la marca completa.",
    pilot: "Monitorización y respuesta centralizada en cinco ubicaciones durante 60 días."
  };
}

export function buildFranchiseAudit(
  brand: string,
  locations: FranchiseLocationInput[],
  options: { officialDomain?: string | null; generatedAt?: Date } = {}
): FranchiseAudit {
  const n = locations.length;
  const ratings = locations.map((l) => l.rating).filter((v): v is number => typeof v === "number");
  const reviews = locations.map((l) => l.userRatingCount ?? 0);
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  const min = ratings.length ? Math.min(...ratings) : null;
  const max = ratings.length ? Math.max(...ratings) : null;
  const variance = avg == null || ratings.length === 0 ? null : ratings.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / ratings.length;
  const sortedReviews = [...reviews].sort((a, b) => b - a);
  const topCount = Math.max(1, Math.ceil(sortedReviews.length / 4));
  const totalReviews = reviews.reduce((a, b) => a + b, 0);
  const official = options.officialDomain ? options.officialDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : null;
  const metrics: FranchiseAudit["metrics"] = {
    sampled: n,
    avgRating: avg == null ? null : round(avg, 2),
    minRating: min,
    maxRating: max,
    ratingSpread: min == null || max == null ? null : round(max - min, 2),
    ratingStdDev: variance == null ? null : round(Math.sqrt(variance), 2),
    lowRatingPct: percentage(locations.filter((l) => (l.rating ?? 5) <= 3.5 && (l.userRatingCount ?? 0) >= 5).length, n),
    noWebsitePct: percentage(locations.filter((l) => !l.website).length, n),
    noPhonePct: percentage(locations.filter((l) => !l.phone && !l.internationalPhone).length, n),
    lowReviewsPct: percentage(locations.filter((l) => (l.userRatingCount ?? 0) < 5).length, n),
    closedPct: percentage(locations.filter((l) => l.businessStatus && l.businessStatus !== "OPERATIONAL").length, n),
    domainMismatchPct: percentage(locations.filter((l) => l.website && !domainMatches(hostname(l.website), official)).length, n),
    reviewsMin: reviews.length ? Math.min(...reviews) : 0,
    reviewsMax: reviews.length ? Math.max(...reviews) : 0,
    reviewConcentrationPct: totalReviews ? percentage(sortedReviews.slice(0, topCount).reduce((a, b) => a + b, 0), totalReviews) : 0
  };

  const findings: FranchiseFinding[] = [];
  const add = (key: string, severity: FranchiseFinding["severity"], title: string, evidence: string, affectedPct: number) => findings.push({ key, severity, title, evidence, affectedPct });
  if ((metrics.ratingSpread ?? 0) >= 0.8) add("rating_spread", (metrics.ratingSpread ?? 0) >= 1.2 ? "high" : "medium", "Experiencia de marca desigual", `La valoración observada oscila entre ${metrics.minRating} y ${metrics.maxRating} estrellas.`, metrics.lowRatingPct);
  if (metrics.lowRatingPct > 0) add("low_rating", metrics.lowRatingPct >= 25 ? "high" : "medium", "Unidades con reputación crítica", `${metrics.lowRatingPct}% de la muestra está en 3,5 estrellas o menos con al menos cinco reseñas.`, metrics.lowRatingPct);
  if (metrics.noWebsitePct > 0) add("no_website", metrics.noWebsitePct >= 20 ? "high" : "medium", "Fichas sin destino web", `${metrics.noWebsitePct}% de las ubicaciones observadas no enlaza una web.`, metrics.noWebsitePct);
  if (metrics.noPhonePct > 0) add("no_phone", metrics.noPhonePct >= 20 ? "high" : "medium", "Contacto local incompleto", `${metrics.noPhonePct}% de la muestra no muestra teléfono.`, metrics.noPhonePct);
  if (metrics.domainMismatchPct > 0) add("domain_mismatch", metrics.domainMismatchPct >= 20 ? "high" : "medium", "Destinos digitales incoherentes", `${metrics.domainMismatchPct}% enlaza un dominio distinto del dominio corporativo observado.`, metrics.domainMismatchPct);
  if (metrics.lowReviewsPct > 0) add("low_reviews", metrics.lowReviewsPct >= 25 ? "high" : "medium", "Unidades casi invisibles", `${metrics.lowReviewsPct}% tiene menos de cinco reseñas.`, metrics.lowReviewsPct);
  if (metrics.closedPct > 0) add("closed", "high", "Estado operativo desactualizado", `${metrics.closedPct}% figura como cerrado o no operativo.`, metrics.closedPct);
  if (metrics.reviewConcentrationPct >= 60 && n >= 4) add("review_concentration", "medium", "La visibilidad se concentra en pocas unidades", `El 25% superior concentra ${metrics.reviewConcentrationPct}% de las reseñas observadas.`, metrics.reviewConcentrationPct);

  const score = Math.min(100, Math.round(
    metrics.lowRatingPct * 0.7 + metrics.closedPct * 0.9 + metrics.noWebsitePct * 0.35 +
    metrics.noPhonePct * 0.25 + metrics.domainMismatchPct * 0.35 + metrics.lowReviewsPct * 0.25 +
    Math.min(20, (metrics.ratingSpread ?? 0) * 12)
  ));
  const partial = { metrics } as FranchiseAudit;
  return {
    version: 2,
    brand,
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    methodology: `Muestra de ${n} fichas públicas observadas. Las métricas describen la muestra y no estiman ventas ni ingresos.`,
    score,
    risk: score >= 75 ? "critical" : score >= 55 ? "high" : score >= 30 ? "medium" : "low",
    metrics,
    findings: findings.sort((a, b) => {
      const weights: Record<FranchiseFinding["severity"], number> = { high: 3, medium: 2, low: 1 };
      return weights[b.severity] - weights[a.severity];
    }).slice(0, 8),
    offer: selectFranchiseOffer(partial)
  };
}

const esc = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildFranchiseAuditSvg(audit: FranchiseAudit): string {
  const m = audit.metrics;
  const cards = [
    ["Riesgo observado", `${audit.score}/100`],
    ["Valoración media", m.avgRating == null ? "—" : `${m.avgRating}★`],
    ["Unidades ≤3,5★", `${m.lowRatingPct}%`],
    ["Sin web", `${m.noWebsitePct}%`],
    ["Sin teléfono", `${m.noPhonePct}%`],
    ["Cerradas/no operativas", `${m.closedPct}%`]
  ];
  const cardSvg = cards.map(([label, value], i) => {
    const x = 48 + (i % 3) * 344;
    const y = 210 + Math.floor(i / 3) * 130;
    return `<rect x="${x}" y="${y}" width="312" height="100" rx="16" fill="#f8fafc" stroke="#dbeafe"/><text x="${x + 20}" y="${y + 32}" font-size="15" fill="#64748b">${esc(label)}</text><text x="${x + 20}" y="${y + 73}" font-size="31" font-weight="700" fill="#0f172a">${esc(value)}</text>`;
  }).join("");
  const findings = audit.findings.slice(0, 4).map((finding, i) => `<circle cx="62" cy="${505 + i * 58}" r="6" fill="${finding.severity === "high" ? "#ef4444" : "#f59e0b"}"/><text x="82" y="${500 + i * 58}" font-size="17" font-weight="700" fill="#0f172a">${esc(finding.title)}</text><text x="82" y="${523 + i * 58}" font-size="14" fill="#475569">${esc(finding.evidence)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="800" viewBox="0 0 1080 800"><rect width="1080" height="800" fill="#ffffff"/><rect width="1080" height="18" fill="#4f46e5"/><text x="48" y="72" font-size="18" font-weight="700" fill="#4f46e5">NEGOCIO VIVO · FRANCHISE INTELLIGENCE</text><text x="48" y="125" font-size="38" font-weight="800" fill="#0f172a">Auditoría de red · ${esc(audit.brand)}</text><text x="48" y="158" font-size="15" fill="#64748b">${esc(audit.methodology)}</text><text x="1028" y="72" text-anchor="end" font-size="13" font-weight="700" fill="#b45309">SIMULACIÓN VISUAL BASADA EN DATOS OBSERVADOS</text>${cardSvg}<text x="48" y="455" font-size="22" font-weight="800" fill="#0f172a">Hallazgos prioritarios</text>${findings}<rect x="48" y="745" width="984" height="1" fill="#e2e8f0"/><text x="48" y="775" font-size="13" fill="#64748b">La visualización resume datos públicos observados; no es una captura literal de Google ni una estimación de ingresos.</text></svg>`;
}

export function summarizeFranchisePipeline(items: Array<{ stage?: string | null }>): Record<string, number> {
  const result: Record<string, number> = { total: items.length };
  for (const item of items) {
    const stage = item.stage || "discovered";
    result[stage] = (result[stage] ?? 0) + 1;
  }
  return result;
}
