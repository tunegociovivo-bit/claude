/**
 * POST /api/v1/gmb/clients/[id]/generate-description → descripción SEO con IA
 * Devuelve { description } (no la guarda; el front la mete en el form de la ficha).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { openaiChatCompletion } from "@/lib/ai/openai";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "ai", rate: "ai" }, async (_req, { params, api }) => {
  const client = await prisma.gmbClient.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { name: true, mainKeyword: true, category: true }
  });
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");

  let prompt = "Genera una descripción profesional y optimizada para SEO local para una ficha de Google Business.\n";
  prompt += `Negocio: ${client.name}\n`;
  if (client.category) prompt += `Categoría: ${client.category}\n`;
  if (client.mainKeyword) prompt += `Palabra clave principal (debe aparecer de forma natural): ${client.mainKeyword}\n`;
  prompt +=
    "\nRequisitos:\n- Máximo 750 caracteres\n- Incluir la palabra clave de forma natural\n- Destacar servicios y propuesta de valor\n- Tono profesional y cercano\n- En español\n- Sin hashtags ni emojis\n\nDescripción:";

  try {
    const description = await openaiChatCompletion({
      workspaceId: api.workspaceId,
      model: "gpt-4o-mini",
      prompt,
      temperature: 0.7,
      maxTokens: 400,
      userId: api.userId,
      feature: "gmb_generate_description"
    });
    return NextResponse.json({ description });
  } catch (e: any) {
    throw new ApiError(502, "ai_error", String(e?.message ?? e));
  }
});
