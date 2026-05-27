/**
 * Clasificador IA de relevancia para resultados de Google Places.
 *
 * Tras una búsqueda Places, no todos los resultados son realmente del nicho
 * que el usuario quiere atacar (p. ej. buscando "masajes eróticos" Google
 * devuelve también centros de masaje terapéutico). Antes de encolar mensajes
 * preguntamos a la IA (Haiku) cuáles de los leads encajan REALMENTE con el
 * intent del usuario y marcamos los que no como excluidos.
 */

import { completeJson, AIDisabledError } from "@/lib/ai/anthropic";

export type LeadForRelevance = {
  placeId: string;
  name: string;
  category?: string | null;
  types?: string[];
  formattedAddress?: string | null;
  website?: string | null;
};

export type RelevanceVerdict = {
  placeId: string;
  relevant: boolean;
  reason: string;
};

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          placeId: { type: "string" },
          relevant: { type: "boolean" },
          reason: { type: "string" }
        },
        required: ["placeId", "relevant", "reason"]
      }
    }
  },
  required: ["items"]
};

/**
 * Clasifica una lista de leads por relevancia con respecto al keyword.
 * En caso de error de IA, todos quedan como relevantes (no descarta nada).
 * Devuelve un Map<placeId, verdict>.
 */
export async function classifyLeadsRelevance(opts: {
  workspaceId: string;
  keyword: string;
  location: string;
  leads: LeadForRelevance[];
}): Promise<Map<string, RelevanceVerdict>> {
  const out = new Map<string, RelevanceVerdict>();
  if (opts.leads.length === 0) return out;

  // Lotes para no saturar Claude: 30 leads por petición.
  const BATCH = 30;
  for (let i = 0; i < opts.leads.length; i += BATCH) {
    const batch = opts.leads.slice(i, i + BATCH);
    try {
      const items = batch.map((l) => ({
        placeId: l.placeId,
        name: l.name,
        category: l.category ?? null,
        types: (l.types ?? []).slice(0, 6),
        address: l.formattedAddress ?? null,
        website: l.website ?? null
      }));
      const system = `Eres un analista de leads B2B. Tu tarea: filtrar resultados de Google Places para una campaña de captación, descartando los que NO coinciden con el nicho que el usuario quiere atacar.

Reglas:
- "relevant: true" SOLO si el negocio encaja claramente con el keyword. Cuando el nicho tiene matices (p. ej. "masajes eróticos" ≠ "masajes terapéuticos / quiromasaje / fisioterapia"), descarta los que sean del nicho ADYACENTE pero distinto.
- "relevant: false" si el nombre / categoría / tipos sugieren otro nicho, o si parece una cadena/franquicia masiva, una clínica médica seria cuando se buscan servicios alternativos, etc.
- "relevant: true" en caso de duda: solo descartamos cuando hay señales claras de que NO es el nicho buscado.
- En "reason": máximo 90 caracteres, en español, explicando por qué se descarta o por qué encaja.

Devuelve SIEMPRE el JSON pedido con un veredicto por cada lead enviado, preservando el placeId tal cual.`;
      const user = `Keyword: "${opts.keyword}"
Localidad: "${opts.location}"

Leads a clasificar:
${JSON.stringify(items, null, 2)}`;

      const resp = await completeJson<{ items: RelevanceVerdict[] }>({
        workspaceId: opts.workspaceId,
        model: "claude-haiku-4-5-20251001",
        system,
        user,
        schema: SCHEMA,
        maxTokens: 2500
      });
      for (const v of resp.items ?? []) {
        if (v?.placeId) {
          out.set(v.placeId, {
            placeId: v.placeId,
            relevant: !!v.relevant,
            reason: (v.reason ?? "").slice(0, 200)
          });
        }
      }
    } catch (e) {
      if (e instanceof AIDisabledError) {
        // Si la IA está deshabilitada, no descartamos nada.
        for (const l of batch) out.set(l.placeId, { placeId: l.placeId, relevant: true, reason: "" });
      } else {
        console.error("[leads.relevance] fallback (todo relevante):", (e as any)?.message ?? e);
        for (const l of batch) out.set(l.placeId, { placeId: l.placeId, relevant: true, reason: "" });
      }
    }
  }
  return out;
}
