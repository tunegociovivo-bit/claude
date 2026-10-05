// Núcleo puro del aprendizaje: elegir qué respuestas humanas pasadas enseñar a
// la IA para el mensaje actual y cómo presentarlas en el prompt.
import { words } from "@/lib/inbox/text";

export type LearningRow = {
  phone: string;
  lineId: string | null;
  customerText: string;
  aiDraft: string | null;
  finalText: string;
  outcome: string; // accepted | edited | rewritten | written | phone
  createdAt: Date;
};

export type ScoredExample = LearningRow & { score: number };

const OUTCOME_WEIGHT: Record<string, number> = {
  edited: 4, // la persona corrigió a la IA: lo más instructivo
  rewritten: 4,
  written: 3,
  phone: 3,
  accepted: 1,
};

export function selectLearningExamples(
  rows: LearningRow[],
  current: { text: string; phone: string; lineId: string | null },
  now: Date,
  limit = 6
): ScoredExample[] {
  const currentWords = new Set(words(current.text, 4));
  const seen = new Set<string>();
  const scored: ScoredExample[] = [];
  for (const row of rows) {
    if (row.phone === current.phone) continue; // su propio historial ya va en la conversación
    if (row.customerText.trim().length < 2 || row.finalText.trim().length < 2) continue;
    const key = row.finalText.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const overlap = words(row.customerText, 4).filter((w) => currentWords.has(w)).length;
    const ageDays = (now.getTime() - row.createdAt.getTime()) / 86_400_000;
    const recency = Math.max(0, 3 - Math.floor(ageDays / 20));
    const sameLine = current.lineId && row.lineId === current.lineId ? 2 : 0;
    const score = overlap * 3 + (OUTCOME_WEIGHT[row.outcome] ?? 1) + recency + sameLine;
    scored.push({ ...row, score });
  }
  return scored.sort((a, b) => b.score - a.score || b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
}

function clip(text: string, max: number) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function buildLearningPrompt(input: { styleGuide: string; examples: ScoredExample[] }): string {
  const blocks: string[] = [];
  if (input.styleGuide.trim()) {
    blocks.push(
      `GUÍA DE ESTILO APRENDIDA DEL EQUIPO (síguela siempre que no contradiga la información del negocio):\n${input.styleGuide.trim()}`
    );
  }
  const corrections = input.examples.filter((e) => (e.outcome === "edited" || e.outcome === "rewritten") && e.aiDraft);
  const replies = input.examples.filter((e) => !corrections.includes(e));
  if (replies.length) {
    blocks.push(
      "EJEMPLOS REALES DE CÓMO RESPONDE EL EQUIPO (imita el tono, la longitud y la estrategia; nunca copies nombres, precios ni datos de otro cliente):\n" +
        replies
          .map((e, i) => `${i + 1}. Cliente: ${clip(e.customerText, 400)}\n   Respuesta del equipo: ${clip(e.finalText, 600)}`)
          .join("\n")
    );
  }
  if (corrections.length) {
    blocks.push(
      "CORRECCIONES QUE EL EQUIPO HIZO A PROPUESTAS ANTERIORES DE LA IA (aprende de ellas y no repitas el error):\n" +
        corrections
          .map(
            (e, i) =>
              `${i + 1}. Cliente: ${clip(e.customerText, 300)}\n   Propuesta de la IA: ${clip(e.aiDraft ?? "", 400)}\n   Lo que envió el equipo: ${clip(e.finalText, 500)}`
          )
          .join("\n")
    );
  }
  return blocks.join("\n\n");
}

// Umbral de muestras nuevas para volver a destilar la guía de estilo.
export function shouldRefreshStyleGuide(input: { pendingSamples: number; refreshedAt: Date | null; locked: boolean }): boolean {
  if (input.locked) return false;
  return input.refreshedAt ? input.pendingSamples >= 8 : input.pendingSamples >= 3;
}

export function learningStats(rows: { outcome: string }[]) {
  const count = (o: string) => rows.filter((r) => r.outcome === o).length;
  const accepted = count("accepted");
  const edited = count("edited");
  const rewritten = count("rewritten");
  const written = count("written");
  const phone = count("phone");
  const withDraft = accepted + edited + rewritten;
  return {
    accepted,
    edited,
    rewritten,
    written,
    phone,
    total: rows.length,
    acceptanceRate: withDraft ? Math.round((accepted / withDraft) * 100) : null,
    usefulRate: withDraft ? Math.round(((accepted + edited) / withDraft) * 100) : null,
  };
}
