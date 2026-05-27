/**
 * POST /api/v1/leads/sequences/generate-ai
 *
 * Genera con IA (Claude Haiku) una propuesta de N pasos para una secuencia
 * de seguimiento de leads. El usuario pasa keyword y tono; Claude devuelve
 * { steps: [{ delayDays, templateBody }] }.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { completeJson } from "@/lib/ai/anthropic";

const schema = z.object({
  keyword: z.string().min(2).max(120),
  tone: z.enum(["cercano", "directo", "consultor", "comercial"]).default("cercano"),
  stepCount: z.number().int().min(2).max(5).default(3)
});

const SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          delayDays: { type: "integer" },
          templateBody: { type: "string" }
        },
        required: ["delayDays", "templateBody"]
      }
    }
  },
  required: ["steps"]
};

const TONE_HINT: Record<string, string> = {
  cercano: "cercano, humano, casual pero profesional",
  directo: "directo y conciso, sin rodeos",
  consultor: "consultor experto, aporta dato/insight",
  comercial: "comercial pero respetuoso, foco en beneficio"
};

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const system = `Eres copywriter de WhatsApp B2B en español de España.
Genera una secuencia de seguimiento de ${parsed.data.stepCount} pasos para captar negocios del nicho "${parsed.data.keyword}".

Reglas:
- El paso 1 va con delayDays=0 (inmediato al añadir el lead).
- Los siguientes se espacian 2-4 días entre sí.
- Cada paso ABORDA UN ÁNGULO DISTINTO (no repitas el de antes):
  · Paso 1: rompehielos + propuesta breve.
  · Paso 2: aporta dato/caso/beneficio concreto.
  · Paso 3+: prueba social o CTA muy concreta ("una llamada de 10 min esta semana").
- Mensajes cortos (≈3-4 frases), separados con \\n\\n.
- TONO: ${TONE_HINT[parsed.data.tone]}.
- Usa placeholders disponibles: {{nombre_negocio}}, {{provincia}}, {{keyword}}, {{posicion}}, {{competidor_top}}. No inventes otros.
- NO uses emojis al inicio. Como máximo 1 emoji al final, opcional.
- Cada mensaje termina con una CTA clara y distinta.

Devuelve SIEMPRE el JSON pedido. Nada más.`;

  const data = await completeJson<{ steps: Array<{ delayDays: number; templateBody: string }> }>({
    workspaceId: api.workspaceId,
    model: "claude-haiku-4-5-20251001",
    system,
    user: `Keyword: "${parsed.data.keyword}"\nTono: ${parsed.data.tone}\nPasos: ${parsed.data.stepCount}`,
    schema: SCHEMA,
    maxTokens: 1500
  });

  return NextResponse.json({ steps: data.steps ?? [] });
});
