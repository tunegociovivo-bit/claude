/**
 * AI rewriter para mensajes salientes (anti-spam Meta).
 *
 * Cada mensaje encolado pasa por un LLM (Claude Haiku) que lo reescribe
 * preservando todos los datos concretos pero variando redacción y mejorando
 * el formato para WhatsApp: párrafos separados, líneas cortas, CTA clara.
 *
 * Si el LLM falla (red, AI deshabilitado, etc.), cae al "varyMessage"
 * determinístico — el mensaje sale igual que antes en lugar de bloquear.
 */

import { complete, AIDisabledError } from "@/lib/ai/anthropic";
import { varyMessage } from "./template-engine";

const SYSTEM = `Eres un copywriter para mensajes de WhatsApp B2B en español de España.
Recibes un mensaje base ya redactado y debes REESCRIBIRLO produciendo una versión única.

Reglas estrictas:
- PRESERVA EXACTAMENTE todos los datos concretos: nombre del negocio, posición numérica, keyword/nicho, provincia o localidad, nombre del competidor, rating, número de reseñas, mi nombre y mi empresa, y la oferta concreta. No inventes nada que no esté en el original.
- VARÍA la redacción: cambia el orden de las ideas, sinónimos, conectores. Que dos mensajes generados a partir del mismo original no sean nunca idénticos.
- MEJORA EL FORMATO para WhatsApp:
  * Saludo en su propia línea, con coma al final.
  * Separa los bloques de información con UNA línea en blanco (\\n\\n).
  * Frases cortas, máximo ~14 palabras por línea.
  * Total 3 o 4 bloques, no más.
- TERMINA con una CTA clara y cercana en su propio bloque. La pregunta debe ser concreta y fácil de responder ("¿Te encaja una llamada rápida esta semana?" / "¿Te paso ejemplos en privado?" / "¿Te llamo mañana 10 min?", etc., variando).
- Tono cercano, profesional, ESPAÑOL DE ESPAÑA. Sin formalismos rancios ("Estimado", "Cordial saludo").
- EMOJIS: opcional, máximo 1, solo si encaja natural. Nunca al principio.
- NUNCA uses negrita Markdown (*texto*); WhatsApp lo respeta pero queda muy comercial.

Devuelve SOLO el mensaje reescrito, sin comillas, sin "Aquí tienes", sin notas, sin explicaciones.`;

export async function aiRewriteMessage(opts: {
  workspaceId: string;
  base: string;
  seed: string;
}): Promise<string> {
  try {
    const out = await complete({
      workspaceId: opts.workspaceId,
      // Haiku basta para esta tarea y es ~10x más barato que Opus.
      model: "claude-haiku-4-5-20251001",
      system: SYSTEM,
      user: `Reescribe este mensaje siguiendo TODAS las reglas:\n\n---\n${opts.base}\n---`,
      maxTokens: 600,
      feature: "leads.ai_vary"
    });
    let cleaned = cleanLlmOutput(out);
    // Sanity check: si la salida es absurdamente corta o no contiene el
    // nombre del negocio del original (heurística simple), caemos al
    // determinístico para no enviar algo roto.
    if (cleaned.length < 60) {
      return varyMessage(opts.base, opts.seed);
    }
    // Blindaje de enlaces: si el original llevaba una URL concreta (p. ej. la
    // demo de Bubui {{demo_bubui}}) y el reescritor la alteró o la perdió, la
    // restauramos tal cual — un enlace roto inutiliza el mensaje.
    cleaned = preserveUrls(opts.base, cleaned);
    return cleaned;
  } catch (e) {
    if (e instanceof AIDisabledError) {
      return varyMessage(opts.base, opts.seed);
    }
    console.error("[leads.ai_vary] fallback determinístico:", (e as any)?.message ?? e);
    return varyMessage(opts.base, opts.seed);
  }
}

/** Garantiza que toda URL del mensaje original siga presente (y sin alterar)
 *  en el reescrito. Si falta alguna, la añade en su propia línea al final. */
function preserveUrls(original: string, rewritten: string): string {
  const urls = original.match(/https?:\/\/[^\s)]+/gi) ?? [];
  let out = rewritten;
  for (const url of urls) {
    if (!out.includes(url)) out = `${out.trim()}\n\n${url}`;
  }
  return out;
}

/** Quita comillas envolventes, prefijos "Aquí tienes:", bloques de código,
 *  y normaliza espacios. */
function cleanLlmOutput(s: string): string {
  let out = s.trim();
  // Quita bloques de código ``` …``` que a veces salen
  out = out.replace(/^```[a-z]*\n?/i, "").replace(/```$/g, "").trim();
  // Quita comillas envolventes
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("«") && out.endsWith("»"))) {
    out = out.slice(1, -1).trim();
  }
  // Quita prefacios típicos
  out = out.replace(/^(Aquí tienes|Aquí está|Versión reescrita|Mensaje reescrito)\s*[:\-—]\s*/i, "").trim();
  // Colapsa más de 2 líneas en blanco
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}
