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
  version: 2 | 3;
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
  priorityLocations?: Array<{ name: string; rating: number | null; reviews: number; issues: string[] }>;
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
  const priorityLocations = locations.map((location) => {
    const issues: string[] = [];
    if (location.businessStatus && location.businessStatus !== "OPERATIONAL") issues.push("Estado no operativo");
    if ((location.rating ?? 5) <= 3.5 && (location.userRatingCount ?? 0) >= 5) issues.push("Valoración crítica");
    if ((location.userRatingCount ?? 0) < 5) issues.push("Visibilidad muy baja");
    if (!location.website) issues.push("Sin web");
    if (!location.phone && !location.internationalPhone) issues.push("Sin teléfono");
    if (location.website && !domainMatches(hostname(location.website), official)) issues.push("Dominio incoherente");
    const priority = (issues.includes("Estado no operativo") ? 100 : 0) + (issues.includes("Valoración crítica") ? 60 : 0)
      + (issues.includes("Visibilidad muy baja") ? 25 : 0) + (issues.includes("Sin web") ? 18 : 0)
      + (issues.includes("Sin teléfono") ? 12 : 0) + (issues.includes("Dominio incoherente") ? 15 : 0)
      + Math.max(0, 5 - (location.rating ?? 5));
    return { name: location.name?.trim() || "Ubicación sin nombre", rating: location.rating ?? null, reviews: location.userRatingCount ?? 0, issues, priority };
  }).sort((a, b) => b.priority - a.priority || a.reviews - b.reviews).slice(0, 5).map(({ priority: _priority, ...location }) => ({
    ...location,
    issues: location.issues.length ? location.issues : ["Menor tracción observada dentro de la muestra"]
  }));
  return {
    version: 3,
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
    offer: selectFranchiseOffer(partial),
    priorityLocations
  };
}

const esc = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildFranchiseAuditSvg(audit: FranchiseAudit): string {
  const m = audit.metrics;
  const clip = (value: unknown, max: number) => { const text = String(value ?? ""); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
  const wrap = (value: string, max: number) => value.split(/\s+/).reduce<string[]>((lines, word) => {
    const last = lines[lines.length - 1];
    if (!last || `${last} ${word}`.length > max) lines.push(word); else lines[lines.length - 1] = `${last} ${word}`;
    return lines;
  }, []).slice(0, 2);
  const riskLabel = audit.risk === "critical" ? "CRÍTICO" : audit.risk === "high" ? "ALTO" : audit.risk === "medium" ? "MEDIO" : "CONTROLADO";
  const riskColor = audit.risk === "critical" ? "#ef4444" : audit.risk === "high" ? "#f97316" : audit.risk === "medium" ? "#f59e0b" : "#10b981";
  const cards = [["FICHAS ANALIZADAS", m.sampled], ["VALORACIÓN MEDIA", m.avgRating == null ? "—" : `${m.avgRating}★`], ["RANGO DE VALORACIÓN", m.minRating == null ? "—" : `${m.minRating}–${m.maxRating}★`], ["RESEÑAS · MÍN / MÁX", `${m.reviewsMin} / ${m.reviewsMax}`]];
  const cardSvg = cards.map(([label, value], i) => { const x = 60 + i * 270; return `<rect x="${x}" y="320" width="250" height="110" rx="18" fill="#fff" stroke="#dbe4f0"/><text x="${x + 20}" y="355" font-size="12" font-weight="700" letter-spacing="1" fill="#64748b">${esc(label)}</text><text x="${x + 20}" y="402" font-size="30" font-weight="800" fill="#0f172a">${esc(value)}</text>`; }).join("");
  const bars = [["Unidades con ≤3,5★", m.lowRatingPct, "#ef4444"], ["Unidades con menos de 5 reseñas", m.lowReviewsPct, "#f59e0b"], ["Fichas sin web", m.noWebsitePct, "#8b5cf6"], ["Reseñas concentradas en el 25% superior", m.reviewConcentrationPct, "#2563eb"]] as const;
  const barSvg = bars.map(([label, value, color], i) => { const y = 520 + i * 58; const width = Math.max(4, Math.min(430, value * 4.3)); return `<text x="60" y="${y}" font-size="15" font-weight="650" fill="#1e293b">${esc(label)}</text><text x="550" y="${y}" text-anchor="end" font-size="15" font-weight="800" fill="${color}">${value}%</text><rect x="60" y="${y + 13}" width="490" height="12" rx="6" fill="#e8eef6"/><rect x="60" y="${y + 13}" width="${width}" height="12" rx="6" fill="${color}"/>`; }).join("");
  const fallbackFinding = { severity: "low", title: "Red estable en la muestra", evidence: "No se observan incidencias críticas; recomendamos control preventivo y medición continua." };
  const findings = (audit.findings.length ? audit.findings : [fallbackFinding]).slice(0, 3).map((finding, i) => { const y = 492 + i * 94; const color = finding.severity === "high" ? "#ef4444" : finding.severity === "medium" ? "#f59e0b" : "#10b981"; return `<rect x="630" y="${y}" width="510" height="76" rx="14" fill="#fff" stroke="#dbe4f0"/><rect x="630" y="${y}" width="6" height="76" rx="3" fill="${color}"/><text x="654" y="${y + 30}" font-size="16" font-weight="800" fill="#0f172a">${esc(clip(finding.title, 48))}</text><text x="654" y="${y + 55}" font-size="13" fill="#64748b">${esc(clip(finding.evidence, 76))}</text>`; }).join("");
  const locations = (audit.priorityLocations ?? []).slice(0, 5);
  const locationRows = locations.length ? locations.map((location, i) => { const y = 868 + i * 58; return `<rect x="60" y="${y - 34}" width="1080" height="50" rx="10" fill="${i % 2 ? "#f8fafc" : "#fff"}"/><text x="78" y="${y}" font-size="14" font-weight="750" fill="#0f172a">${esc(clip(location.name, 42))}</text><text x="500" y="${y}" font-size="14" font-weight="700" fill="#334155">${location.rating == null ? "—" : `${location.rating}★`} · ${location.reviews} reseñas</text><text x="700" y="${y}" font-size="13" fill="#b45309">${esc(clip(location.issues.join(" · "), 58))}</text>`; }).join("") : `<rect x="60" y="834" width="1080" height="86" rx="14" fill="#fff7ed"/><text x="84" y="871" font-size="16" font-weight="800" fill="#9a3412">Actualiza esta auditoría para identificar establecimientos concretos</text><text x="84" y="898" font-size="13" fill="#9a3412">La versión anterior conserva métricas, pero no el detalle de ubicaciones prioritarias.</text>`;
  const planY = locations.length ? 1210 : 1030;
  const steps = [["DÍAS 0–15", "Corrección y prioridad", "Validar datos, accesos y unidades con mayor riesgo."], ["DÍAS 16–30", "Activación local", "Optimizar fichas, respuestas y captación de reseñas."], ["DÍAS 31–60", "Medición con control", "Comparar evolución frente a unidades no intervenidas."]];
  const stepsSvg = steps.map(([period, title, body], i) => { const x = 60 + i * 360; const lines = wrap(body, 47); return `<rect x="${x}" y="${planY + 46}" width="330" height="132" rx="18" fill="#0f172a"/><text x="${x + 22}" y="${planY + 78}" font-size="12" font-weight="800" letter-spacing="1" fill="#a5b4fc">${period}</text><text x="${x + 22}" y="${planY + 111}" font-size="17" font-weight="800" fill="#fff">${esc(title)}</text><text x="${x + 22}" y="${planY + 140}" font-size="12" fill="#cbd5e1">${esc(lines[0] ?? "")}</text><text x="${x + 22}" y="${planY + 158}" font-size="12" fill="#cbd5e1">${esc(lines[1] ?? "")}</text>`; }).join("");
  const height = planY + 390;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}"><defs><linearGradient id="hero" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset=".58" stop-color="#312e81"/><stop offset="1" stop-color="#4f46e5"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#0f172a" flood-opacity=".12"/></filter></defs><rect width="1200" height="${height}" fill="#f4f7fb"/><rect width="1200" height="276" fill="url(#hero)"/><circle cx="1080" cy="30" r="210" fill="#818cf8" opacity=".13"/><text x="60" y="60" font-size="14" font-weight="800" letter-spacing="2" fill="#c7d2fe">NEGOCIO VIVO · FRANCHISE INTELLIGENCE</text><text x="60" y="124" font-size="43" font-weight="850" fill="#fff">Auditoría de presencia local</text><text x="60" y="176" font-size="31" font-weight="750" fill="#e0e7ff">${esc(clip(audit.brand, 45))}</text><text x="60" y="224" font-size="14" fill="#cbd5e1">Análisis independiente de ${m.sampled} fichas públicas · ${esc(new Date(audit.generatedAt).toLocaleDateString("es-ES"))}</text><rect x="930" y="82" width="210" height="126" rx="24" fill="#fff" filter="url(#shadow)"/><text x="1035" y="118" text-anchor="middle" font-size="12" font-weight="800" letter-spacing="1" fill="${riskColor}">RIESGO ${riskLabel}</text><text x="1035" y="174" text-anchor="middle" font-size="48" font-weight="900" fill="#0f172a">${audit.score}<tspan font-size="20" fill="#64748b">/100</tspan></text>${cardSvg}<text x="60" y="480" font-size="23" font-weight="850" fill="#0f172a">Radiografía de la red</text>${barSvg}<text x="630" y="460" font-size="23" font-weight="850" fill="#0f172a">Qué requiere atención</text>${findings}<text x="60" y="800" font-size="23" font-weight="850" fill="#0f172a">Establecimientos prioritarios</text><text x="1140" y="800" text-anchor="end" font-size="12" fill="#64748b">Reputación · visibilidad · integridad de ficha</text>${locationRows}<text x="60" y="${planY}" font-size="23" font-weight="850" fill="#0f172a">Plan recomendado de 60 días</text>${stepsSvg}<rect x="60" y="${planY + 214}" width="1080" height="112" rx="20" fill="#eef2ff" stroke="#c7d2fe"/><text x="88" y="${planY + 249}" font-size="12" font-weight="800" letter-spacing="1" fill="#4f46e5">PILOTO PROPUESTO</text><text x="88" y="${planY + 282}" font-size="22" font-weight="850" fill="#1e1b4b">${esc(clip(audit.offer.title, 70))}</text><text x="88" y="${planY + 309}" font-size="14" fill="#4338ca">${esc(clip(audit.offer.pilot, 125))}</text><text x="60" y="${height - 28}" font-size="11" fill="#64748b">SIMULACIÓN VISUAL BASADA EN DATOS OBSERVADOS · No es una captura literal ni una estimación de ingresos. ${esc(audit.methodology)}</text></svg>`;
}

export function summarizeFranchisePipeline(items: Array<{ stage?: string | null }>): Record<string, number> {
  const result: Record<string, number> = { total: items.length };
  for (const item of items) {
    const stage = item.stage || "discovered";
    result[stage] = (result[stage] ?? 0) + 1;
  }
  return result;
}
