/**
 * Fixtures de DEMO del Centro de crecimiento (datos de ejemplo, NUNCA reales ni guardados).
 * Centralizados y testeados para que ningún panel de la demo quede vacío. Marcados como ejemplo.
 * El AI Council de demo trae resultados de EJEMPLO explícitos: jamás finge una llamada real.
 */
export const GROWTH_DEMO = {
  presence: {
    score: 62,
    breakdown: { profile: 80, reviews: 70, content: 45, citations: 40, ranking: 55, web: 60 },
    weights: { profile: 20, reviews: 25, content: 15, citations: 15, ranking: 15, web: 10 },
    opportunities: [
      { module: "citations", type: "fix_inconsistencies", title: "Corregir 3 NAP inconsistentes", description: "Directorios con teléfono antiguo. Unifica el NAP para no penalizar el SEO local.", impact: 70, effort: 35, confidence: 85, priority: 170, external: true },
      { module: "reviews", type: "reply_reviews", title: "Responder reseñas pendientes", description: "Tasa de respuesta 55%. Responder todas mejora ranking y confianza.", impact: 65, effort: 20, confidence: 90, priority: 292, external: true },
      { module: "content", type: "schedule_posts", title: "Programar publicaciones semanales", description: "Solo 1 post en 30 días. Programa 1 novedad/semana.", impact: 50, effort: 30, confidence: 80, priority: 133, external: true }
    ],
    history: [] as { total: number; recordedAt: string }[]
  },
  citations: {
    citations: [
      { id: "d1", directoryName: "Google Business Profile", authority: 100, status: "published", diffs: null },
      { id: "d2", directoryName: "Páginas Amarillas", authority: 70, status: "inconsistent", diffs: { phone: true } },
      { id: "d3", directoryName: "Yelp España", authority: 74, status: "not_found", diffs: null }
    ],
    summary: { total: 3, actionable: 2, byStatus: { published: 1, inconsistent: 1, not_found: 1 } },
    recommendations: [{ slug: "bing-places", name: "Bing Places", authority: 80, submitUrl: "#" }]
  },
  actions: {
    actions: [
      { id: "a1", title: "Responder reseñas pendientes", module: "reviews", impact: 65, effort: 20, confidence: 90, status: "needs_approval", external: true, source: "rule" },
      { id: "a2", title: "Añadir descripción del negocio", module: "presence", impact: 60, effort: 20, confidence: 90, status: "suggested", external: false, source: "rule" },
      { id: "a3", title: "Subir más fotos", module: "content", impact: 55, effort: 25, confidence: 85, status: "prepared", external: false, source: "rule" },
      { id: "a4", title: "Optimizar categoría principal", module: "presence", impact: 62, effort: 30, confidence: 80, status: "suggested", external: false, source: "ai_council" }
    ],
    summary: { total: 4, open: 4 }, autopilotMode: "suggest_only"
  },
  aiCouncil: {
    providers: [
      { provider: "anthropic", connected: false }, { provider: "openai", connected: false },
      { provider: "gemini", connected: false }, { provider: "perplexity", connected: false }
    ],
    connectedCount: 0,
    // Resultado de EJEMPLO (no es una consulta real). Se etiqueta como demo en la UI.
    exampleRun: {
      status: "done",
      models: [
        { provider: "anthropic", model: "claude-sonnet", status: "ok", latencyMs: 1400, costUsd: 0.0021 },
        { provider: "openai", model: "gpt-5", status: "ok", latencyMs: 1600, costUsd: 0.0018 }
      ],
      proposals: [
        { title: "Responder reseñas negativas en 24h", description: "Protocolo de respuesta rápida y empática.", impact: 75, effort: 25, confidence: 88, agreement: 2, providers: ["anthropic", "openai"] },
        { title: "Publicar 1 novedad/semana con foto", description: "Cadencia constante para señales de actividad.", impact: 60, effort: 30, confidence: 82, agreement: 2, providers: ["anthropic", "openai"] }
      ],
      discrepancies: [
        { title: "Invertir en Local Service Ads", description: "Solo un modelo lo prioriza.", impact: 55, effort: 60, confidence: 60, agreement: 1, providers: ["openai"] }
      ],
      costUsd: 0.0039, latencyMs: 1600
    },
    runs: [] as any[]
  },
  rank: {
    provider: { provider: "google_maps", connected: false, reason: "sin_clave_maps" },
    tracked: 2,
    keywords: [
      { keyword: "cafetería málaga centro", isPrimary: true, avgPosition: 4.2, top3Count: 3, foundCount: 7, cellCount: 9, visibilityShare: 78, lastCheckedAt: null },
      { keyword: "desayunos málaga", isPrimary: false, avgPosition: 8.1, top3Count: 0, foundCount: 4, cellCount: 9, visibilityShare: 44, lastCheckedAt: null }
    ],
    gap: { market: { avgRating: 4.5, avgReviews: 95, count: 4 }, you: { rating: 4.2, reviewCount: 40 }, reviewGap: 55, ratingGap: 0.3, categoryGaps: ["desayunos", "brunch"], ahead: false }
  },
  reviews: {
    rules: { autoReplyEnabled: false, autoReplyMinRating: 4, neverAutoOnRisk: true },
    summary: { total: 12, analyzed: 12, sentiment: { positive: 7, neutral: 2, negative: 3 }, avgScore: 0.34, topTopics: [{ topic: "atención", count: 5 }, { topic: "precio", count: 3 }], highUrgency: 2, atRisk: 1, pendingResponse: 4 },
    items: [
      { id: "r1", authorName: "Ana", rating: 2, comment: "Trato lento y algo caro", hasReply: false, analysis: { sentiment: "negative", score: -0.5, topics: ["atención", "precio"], urgency: "high", risk: "low", intent: "complaint", suggestedTone: "empático y resolutivo", needsResponse: true }, reply: { requiresApproval: true, reason: "auto-respuesta desactivada" } },
      { id: "r2", authorName: "Luis", rating: 5, comment: "Excelente, muy amables", hasReply: true, analysis: { sentiment: "positive", score: 0.8, topics: ["atención"], urgency: "low", risk: "low", intent: "praise", suggestedTone: "agradecido y cercano", needsResponse: false }, reply: { requiresApproval: true, reason: "—" } }
    ]
  },
  content: {
    cadence: { status: "low", postsLast30: 1, target: 4, message: "Cadencia baja (1/4). Programa más novedades." },
    ideas: [
      { type: "update", title: "Novedades de la cafetería", content: "Cuenta una novedad reciente con una foto real.", cta: "Más información" },
      { type: "offer", title: "Oferta especial", content: "Promoción por tiempo limitado con condiciones y fecha de fin.", cta: "Ver oferta" },
      { type: "event", title: "Evento o jornada", content: "Anuncia un evento con fecha, hora y cómo apuntarse.", cta: "Reservar" }
    ],
    recent: [{ id: "p1", title: "Nuevo horario de verano", status: "published", scheduledAt: null, publishedAt: "2026-07-01T10:00:00Z" }]
  },
  web: {
    hasWebsite: false,
    recommendations: [
      { type: "page", title: "Crear web/landing local", detail: "La ficha no tiene web. Una landing con NAP y reseñas mejora la conversión.", impact: 70 },
      { type: "schema", title: "Datos estructurados LocalBusiness", detail: "Añade JSON-LD con dirección, teléfono, horario y geo.", impact: 60 }
    ],
    schema: { "@context": "https://schema.org", "@type": "LocalBusiness", name: "Cafetería Demo", telephone: "952000000", address: { "@type": "PostalAddress", streetAddress: "C/ Ejemplo 1", addressLocality: "Málaga", addressCountry: "ES" } }
  }
};

export type GrowthDemo = typeof GROWTH_DEMO;
