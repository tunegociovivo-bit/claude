/**
 * Análisis de competencia con Claude.
 * Lee el campo `competitors` del cliente (URLs/nombres por línea) y
 * devuelve un array estructurado de temas trending + tono + sugerencias.
 *
 * Si el cliente no tiene competidores, Claude busca por sector usando
 * `industry` o el brief.
 */

import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/ai/anthropic";

export type CompetitorTopic = {
  topic: string;
  tone: string;
  suggestions: string[];
  suggestedFormat: "imagen" | "reel" | "carrusel" | "story" | "video";
};

export async function analyzeCompetitors(opts: {
  workspaceId: string;
  clientId: string;
}): Promise<{ topics: CompetitorTopic[]; competitorsList: string[] }> {
  const client = await prisma.client.findFirst({
    where: { id: opts.clientId, workspaceId: opts.workspaceId, deletedAt: null }
  });
  if (!client) throw new Error("Cliente no encontrado");

  const competitorsList = (client.competitors ?? "")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const competitorsBlock =
    competitorsList.length > 0
      ? `## Competidores listados por el equipo\n${competitorsList.map((c) => `- ${c}`).join("\n")}`
      : `## Competidores\n(El cliente no listó competidores. Usa tu conocimiento del sector "${client.industry ?? "marketing"}" para inferir 3-5 competidores típicos.)`;

  const briefBlock = client.brandBrief?.trim()
    ? `## Brief del cliente\n${client.brandBrief}`
    : "";

  const system = `Eres un analista de social media. Te paso un cliente y sus competidores. Devuelve 5-8 TEMAS distintos que están funcionando en su nicho ahora mismo (basado en tu conocimiento del sector + competidores listados).

Para cada tema:
- topic: enunciado corto del tema (max 70 chars)
- tone: en 2-3 palabras (educativo, emocional, urgencia, autoridad, …)
- suggestions: array de 1-3 ángulos concretos para una publicación
- suggestedFormat: imagen | reel | carrusel | story | video

Variedad: no más de 2 temas con el mismo tono ni el mismo formato.`;

  const user = `## Cliente
${client.name}${client.industry ? ` (sector: ${client.industry})` : ""}

${briefBlock}

${competitorsBlock}

Devuelve el array de temas.`;

  const out = await completeJson<{ topics: CompetitorTopic[] }>({
    workspaceId: opts.workspaceId,
    system,
    user,
    schema: {
      type: "object",
      properties: {
        topics: {
          type: "array",
          items: {
            type: "object",
            properties: {
              topic: { type: "string" },
              tone: { type: "string" },
              suggestions: { type: "array", items: { type: "string" } },
              suggestedFormat: {
                type: "string",
                enum: ["imagen", "reel", "carrusel", "story", "video"]
              }
            },
            required: ["topic", "tone", "suggestions", "suggestedFormat"]
          }
        }
      },
      required: ["topics"]
    } as any,
    maxTokens: 3000
  });

  return { topics: out.topics, competitorsList };
}
