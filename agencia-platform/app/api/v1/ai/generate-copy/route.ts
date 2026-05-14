import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { complete, AIDisabledError } from "@/lib/ai/anthropic";

const schema = z.object({
  channel: z.enum(["instagram", "linkedin", "tiktok", "email", "blog", "ads"]),
  brief: z.string().min(5).max(2000),
  clientId: z.string().optional(),
  tone: z.string().optional() // ej. "cercano, ligero, juvenil"
});

const channelGuides: Record<string, string> = {
  instagram:
    "Genera 3 propuestas distintas. Cada una con un caption listo para publicar (≤220 caracteres), 5 hashtags relevantes y una idea visual breve. Lenguaje cercano y emocional.",
  linkedin:
    "Genera un post de LinkedIn (3-5 párrafos cortos) que abra con un gancho, tenga un cuerpo con valor y termine con una llamada a la acción. Tono profesional cercano.",
  tiktok:
    "Genera 3 hooks de 1ª frase (≤80 caracteres) + un guion breve de 15-20 segundos para cada uno. Tono dinámico y conversacional.",
  email:
    "Genera un email completo: asunto (varias opciones), preview text, cuerpo en HTML simple y CTA final. Tono cercano pero claro.",
  blog:
    "Genera un esquema de artículo de blog: H1, meta-descripción, H2/H3 desglosados, y un primer párrafo que enganche.",
  ads:
    "Genera 3 variantes de copy de anuncio (Meta o Google Ads): título (≤30 chars), descripción (≤90 chars) y CTA. Indica para qué fase del funnel sirve cada una."
};

export const POST = withApi({ scope: "ai" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  let clientContext = "";
  if (parsed.data.clientId) {
    const c = await prisma.client.findFirst({
      where: { id: parsed.data.clientId, workspaceId: api.workspaceId }
    });
    if (c) {
      clientContext = `\n\nContexto del cliente: ${c.name} — ${c.industry ?? "sin sector"}. Notas internas: ${c.notes ?? ""}`;
    }
  }

  try {
    const text = await complete({
      workspaceId: api.workspaceId,
      system:
        "Eres copywriter senior de una agencia de marketing española. Escribes copy creativo, claro y orientado a resultados. Adaptas tono a la marca. Devuelves Markdown limpio sin preámbulos.",
      user: `Canal: ${parsed.data.channel.toUpperCase()}
Brief: ${parsed.data.brief}
Tono solicitado: ${parsed.data.tone ?? "consistente con la marca"}${clientContext}

Instrucciones para este canal: ${channelGuides[parsed.data.channel]}`,
      maxTokens: 2048,
      thinking: true
    });
    return NextResponse.json({ text: text.trim(), channel: parsed.data.channel });
  } catch (e) {
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    throw e;
  }
});
