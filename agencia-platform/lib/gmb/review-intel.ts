/**
 * Review Intelligence — análisis PURO de reseñas (sin red): sentimiento, temas, urgencia, riesgo,
 * intención y tono de respuesta sugerido. Trabaja sobre la ingestión existente (GmbReview vía Make).
 *
 * Las respuestas NUNCA se auto-publican por defecto: aquí solo se CLASIFICA y se decide, según
 * reglas por ficha, si una respuesta puede auto-sugerirse o requiere aprobación humana.
 */

export type Sentiment = "positive" | "neutral" | "negative";
export type Level = "low" | "medium" | "high";
export type Intent = "praise" | "complaint" | "question" | "mixed" | "other";

const strip = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Léxicos ES (mínimos, ampliables). Cada término suma señal a su categoría.
const NEG_WORDS = ["fatal", "pesimo", "horrible", "malisimo", "nunca mas", "no vuelvo", "estafa", "verguenza", "asco", "sucio", "lento", "tardaron", "grosero", "borde", "maleducado", "caro", "engano", "decepcion", "roto", "frio"];
const POS_WORDS = ["excelente", "genial", "encanto", "maravilla", "perfecto", "recomiendo", "estupendo", "amable", "rapido", "limpio", "buenisimo", "fantastico", "atentos", "profesional", "delicioso"];
const RISK_WORDS = ["denuncia", "abogado", "legal", "demanda", "sanidad", "intoxicacion", "agresion", "insulto", "racista", "robo", "policia", "estafa"];
const TOPIC_LEXICON: [string, string[]][] = [
  ["atención", ["atencion", "trato", "amable", "grosero", "maleducado", "personal", "camarero", "dependienta", "atentos", "borde"]],
  ["precio", ["precio", "caro", "barato", "coste", "tarifa", "carisimo", "relacion calidad precio"]],
  ["calidad", ["calidad", "producto", "delicioso", "sabor", "malo", "bueno", "fresco", "roto"]],
  ["limpieza", ["limpio", "sucio", "higiene", "limpieza", "olor"]],
  ["espera", ["espera", "lento", "rapido", "tardaron", "cola", "tiempo", "puntual"]],
  ["ubicación", ["ubicacion", "aparcamiento", "parking", "sitio", "zona", "acceso"]]
];

export type ReviewInput = { rating: number; comment?: string | null; reviewTime?: string | Date | null; hasReply?: boolean };
export type ReviewAnalysis = {
  sentiment: Sentiment;
  score: number; // -1..1
  topics: string[];
  urgency: Level;
  risk: Level;
  intent: Intent;
  suggestedTone: string;
  needsResponse: boolean;
};

function countHits(text: string, words: string[]): number {
  return words.reduce((n, w) => (text.includes(w) ? n + 1 : n), 0);
}

export function analyzeReview(r: ReviewInput): ReviewAnalysis {
  const text = strip(r.comment ?? "");
  const neg = countHits(text, NEG_WORDS);
  const pos = countHits(text, POS_WORDS);
  const riskHits = countHits(text, RISK_WORDS);
  const rating = Math.max(0, Math.min(5, r.rating || 0));

  // Score combina estrellas (peso 0.6) y léxico (0.4).
  const starScore = rating > 0 ? (rating - 3) / 2 : 0; // 1★→-1, 3★→0, 5★→1
  const lexScore = pos + neg === 0 ? 0 : (pos - neg) / (pos + neg);
  const score = Math.max(-1, Math.min(1, starScore * 0.6 + lexScore * 0.4));
  const sentiment: Sentiment = score > 0.2 ? "positive" : score < -0.2 ? "negative" : "neutral";

  const topics = TOPIC_LEXICON.filter(([, words]) => countHits(text, words) > 0).map(([t]) => t);
  const isQuestion = /\?|¿/.test(r.comment ?? "");

  const risk: Level = riskHits >= 1 ? "high" : sentiment === "negative" && rating <= 1 ? "medium" : "low";
  const urgency: Level = risk === "high" ? "high" : sentiment === "negative" ? (rating <= 2 ? "high" : "medium") : isQuestion ? "medium" : "low";
  const intent: Intent = isQuestion && sentiment === "negative" ? "mixed" : isQuestion ? "question" : sentiment === "negative" ? "complaint" : sentiment === "positive" ? "praise" : "other";
  const suggestedTone = sentiment === "negative" ? "empático y resolutivo" : sentiment === "positive" ? "agradecido y cercano" : "cordial y neutral";
  const needsResponse = !r.hasReply && (sentiment !== "positive" || isQuestion || rating <= 3);

  return { sentiment, score: Math.round(score * 100) / 100, topics, urgency, risk, intent, suggestedTone, needsResponse };
}

export type ReviewIntelSummary = {
  total: number;
  analyzed: number;
  sentiment: { positive: number; neutral: number; negative: number };
  avgScore: number;
  topTopics: { topic: string; count: number }[];
  highUrgency: number;
  atRisk: number;
  pendingResponse: number;
};

export function summarizeReviews(reviews: (ReviewInput & { analysis?: ReviewAnalysis })[]): ReviewIntelSummary {
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  const topicCount = new Map<string, number>();
  let scoreSum = 0, highUrgency = 0, atRisk = 0, pending = 0;
  for (const r of reviews) {
    const a = r.analysis ?? analyzeReview(r);
    sentiment[a.sentiment]++;
    scoreSum += a.score;
    for (const t of a.topics) topicCount.set(t, (topicCount.get(t) ?? 0) + 1);
    if (a.urgency === "high") highUrgency++;
    if (a.risk === "high") atRisk++;
    if (a.needsResponse) pending++;
  }
  const topTopics = [...topicCount.entries()].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count).slice(0, 6);
  return { total: reviews.length, analyzed: reviews.length, sentiment, avgScore: reviews.length ? Math.round((scoreSum / reviews.length) * 100) / 100 : 0, topTopics, highUrgency, atRisk, pendingResponse: pending };
}

// Reglas de aprobación de respuestas por ficha (nunca auto-publica por defecto).
export type ReplyRules = {
  autoReplyEnabled: boolean; // si false → todo requiere aprobación
  autoReplyMinRating: number; // solo auto-sugerir para rating >= este umbral (p.ej. 4)
  neverAutoOnRisk: boolean; // si hay riesgo alto, siempre aprobación humana
};
export const DEFAULT_REPLY_RULES: ReplyRules = { autoReplyEnabled: false, autoReplyMinRating: 4, neverAutoOnRisk: true };

export type ReplyDecision = { canAutoSuggest: boolean; requiresApproval: boolean; reason: string };

/** Decide si una respuesta puede AUTO-SUGERIRSE (draft sin enviar) o requiere aprobación humana.
 *  Nunca implica publicar: publicar es siempre una acción externa aparte que exige aprobación. */
export function decideReply(a: ReviewAnalysis, rating: number, rules: ReplyRules = DEFAULT_REPLY_RULES): ReplyDecision {
  if (!rules.autoReplyEnabled) return { canAutoSuggest: false, requiresApproval: true, reason: "auto-respuesta desactivada para esta ficha" };
  if (rules.neverAutoOnRisk && a.risk === "high") return { canAutoSuggest: false, requiresApproval: true, reason: "riesgo alto: revisión humana obligatoria" };
  if (rating < rules.autoReplyMinRating) return { canAutoSuggest: false, requiresApproval: true, reason: `rating ${rating} < umbral ${rules.autoReplyMinRating}` };
  return { canAutoSuggest: true, requiresApproval: false, reason: "cumple reglas de auto-sugerencia (borrador, no publica)" };
}
