import { describe, it, expect } from "vitest";
import { analyzeReview, summarizeReviews, decideReply, buildReplyDraft, DEFAULT_REPLY_RULES } from "../review-intel";

describe("analyzeReview", () => {
  it("reseña 1★ con palabras negativas → negativo, urgencia alta", () => {
    const a = analyzeReview({ rating: 1, comment: "Trato pésimo y muy lento, no vuelvo" });
    expect(a.sentiment).toBe("negative");
    expect(a.urgency).toBe("high");
    expect(a.topics).toContain("atención");
    expect(a.topics).toContain("espera");
    expect(a.needsResponse).toBe(true);
  });
  it("reseña 5★ positiva → positivo, tono agradecido", () => {
    const a = analyzeReview({ rating: 5, comment: "Excelente atención, muy amable y rápido. Recomiendo", hasReply: true });
    expect(a.sentiment).toBe("positive");
    expect(a.suggestedTone).toMatch(/agradec/);
    expect(a.needsResponse).toBe(false); // ya respondida
  });
  it("riesgo: menciones legales → riesgo alto y urgencia alta", () => {
    const a = analyzeReview({ rating: 2, comment: "Voy a poner una denuncia, esto es una estafa" });
    expect(a.risk).toBe("high");
    expect(a.urgency).toBe("high");
  });
  it("pregunta → intención question y necesita respuesta", () => {
    const a = analyzeReview({ rating: 4, comment: "¿Abrís los domingos?" });
    expect(a.intent).toBe("question");
    expect(a.needsResponse).toBe(true);
  });
});

describe("summarizeReviews", () => {
  it("agrega sentimiento, temas y pendientes", () => {
    const s = summarizeReviews([
      { rating: 1, comment: "fatal, sucio" },
      { rating: 5, comment: "genial y limpio", hasReply: true },
      { rating: 3, comment: "precio caro" }
    ]);
    expect(s.total).toBe(3);
    expect(s.sentiment.negative).toBeGreaterThanOrEqual(1);
    expect(s.topTopics.length).toBeGreaterThan(0);
    expect(s.pendingResponse).toBeGreaterThanOrEqual(1);
  });
});

describe("decideReply — nunca auto-publica por defecto", () => {
  it("reglas por defecto: siempre requiere aprobación", () => {
    const a = analyzeReview({ rating: 5, comment: "genial" });
    const d = decideReply(a, 5, DEFAULT_REPLY_RULES);
    expect(d.canAutoSuggest).toBe(false);
    expect(d.requiresApproval).toBe(true);
  });
  it("con auto activado y rating alto sin riesgo → auto-sugerencia (borrador, no publica)", () => {
    const a = analyzeReview({ rating: 5, comment: "genial amable" });
    const d = decideReply(a, 5, { autoReplyEnabled: true, autoReplyMinRating: 4, neverAutoOnRisk: true });
    expect(d.canAutoSuggest).toBe(true);
  });
  it("riesgo alto → siempre aprobación aunque auto esté activado", () => {
    const a = analyzeReview({ rating: 5, comment: "denuncia abogado" });
    const d = decideReply(a, 5, { autoReplyEnabled: true, autoReplyMinRating: 4, neverAutoOnRisk: true });
    expect(d.requiresApproval).toBe(true);
    expect(d.canAutoSuggest).toBe(false);
  });
  it("rating bajo el umbral → aprobación", () => {
    const a = analyzeReview({ rating: 2, comment: "regular" });
    const d = decideReply(a, 2, { autoReplyEnabled: true, autoReplyMinRating: 4, neverAutoOnRisk: true });
    expect(d.requiresApproval).toBe(true);
  });
});

describe("buildReplyDraft — borrador editable, no publica", () => {
  it("negativa → tono empático que ofrece solución", () => {
    const a = analyzeReview({ rating: 1, comment: "trato pésimo" });
    const draft = buildReplyDraft(a, { businessName: "Café Demo", authorName: "Ana" });
    expect(draft).toMatch(/lamentamos/i);
    expect(draft).toContain("Café Demo");
    expect(draft).toContain("Ana");
  });
  it("positiva → agradece", () => {
    const a = analyzeReview({ rating: 5, comment: "excelente amable" });
    expect(buildReplyDraft(a, { businessName: "X" })).toMatch(/gracias/i);
  });
  it("pregunta → deja hueco para respuesta concreta", () => {
    const a = analyzeReview({ rating: 4, comment: "¿abrís domingos?" });
    expect(buildReplyDraft(a, {})).toMatch(/\[completa/i);
  });
});
