export type MetaCommentForAnalysis = { id: string; message?: string | null };
export type MetaCommentAnalysis = { id: string; sentiment: "positive" | "neutral" | "negative"; reason: string; draft: string };

export function fallbackMetaCommentAnalysis(comment: MetaCommentForAnalysis): MetaCommentAnalysis {
  const message = String(comment.message ?? "").toLowerCase();
  const negative = /(estafa|fraude|enga[ñn]o|no funciona|p[eé]simo|horrible|fatal|verg[uü]enza|denuncia|queja|mala experiencia|mal servicio|no (?:lo |la |os |las )?recomiendo|decepcionad[oa]|no (?:me )?contest(?:a|an|[áa]is)|devoluci[oó]n|(?:me )?cobrar(?:on)? de m[aá]s)/.test(message);
  const positive = !negative && /(gracias|genial|excelente|fant[aá]stic|enhorabuena|me encanta|muy bien)/.test(message);
  if (negative) {
    return {
      id: comment.id,
      sentiment: "negative",
      reason: "Posible queja detectada; pendiente de revisión IA",
      draft: "Sentimos que hayas tenido esta experiencia. Escríbenos por mensaje privado para poder revisarlo contigo."
    };
  }
  if (positive) {
    return { id: comment.id, sentiment: "positive", reason: "Comentario positivo detectado", draft: "¡Muchas gracias por tu comentario!" };
  }
  return {
    id: comment.id,
    sentiment: "neutral",
    reason: "Pendiente de revisión IA",
    draft: "Gracias por tu comentario. ¿Podemos ayudarte por mensaje privado?"
  };
}

function completeAndValid(comments: MetaCommentForAnalysis[], analyses: MetaCommentAnalysis[] | null | undefined) {
  if (!Array.isArray(analyses)) return null;
  const byId = new Map(analyses.map((analysis) => [String(analysis?.id ?? ""), analysis]));
  const normalized = comments.map((comment) => byId.get(comment.id)).filter((analysis): analysis is MetaCommentAnalysis =>
    !!analysis
    && typeof analysis.id === "string"
    && ["positive", "neutral", "negative"].includes(analysis.sentiment)
    && typeof analysis.reason === "string"
    && typeof analysis.draft === "string"
    && analysis.draft.trim().length > 0
  );
  return normalized.length === comments.length ? normalized : null;
}

export async function runMetaCommentAnalysisPipeline(
  comments: MetaCommentForAnalysis[],
  primary: () => Promise<MetaCommentAnalysis[]>,
  secondary: () => Promise<MetaCommentAnalysis[]>
): Promise<MetaCommentAnalysis[]> {
  try {
    const result = completeAndValid(comments, await primary());
    if (result) return result;
  } catch {}
  try {
    const result = completeAndValid(comments, await secondary());
    if (result) return result;
  } catch {}
  return comments.map(fallbackMetaCommentAnalysis);
}

export function parseMetaCommentAnalysisJson(text: string): MetaCommentAnalysis[] {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error("La IA alternativa no devolvió JSON");
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed?.items)) throw new Error("La IA alternativa no devolvió items");
  return parsed.items;
}
