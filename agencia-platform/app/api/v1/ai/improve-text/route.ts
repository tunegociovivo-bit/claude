import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { complete, AIDisabledError } from "@/lib/ai/anthropic";

const schema = z.object({
  text: z.string().min(1).max(20000),
  action: z.enum(["shorten", "expand", "formal", "casual", "bullet", "fix"]).default("fix")
});

const actionPrompts: Record<string, string> = {
  shorten: "Acorta el texto al menos a la mitad sin perder ninguna idea importante. Mantén el mismo idioma.",
  expand: "Expande el texto con más detalle, ejemplos y matices, conservando el tono y el idioma.",
  formal: "Reescribe el texto en un tono profesional y formal, conservando el idioma y la información.",
  casual: "Reescribe el texto en un tono cercano y conversacional, conservando el idioma y la información.",
  bullet: "Convierte el texto en una lista de viñetas concisas.",
  fix: "Corrige ortografía, gramática y puntuación. Mejora claridad sin cambiar el significado ni el idioma."
};

export const POST = withApi({ scope: "ai", rate: "ai" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  try {
    const text = await complete({
      workspaceId: api.workspaceId,
      system:
        "Eres editor profesional. Trabajas para una agencia de marketing. Devuelves SOLO el texto reescrito, sin preámbulos, comillas, ni explicaciones.",
      user: `${actionPrompts[parsed.data.action]}\n\nTexto:\n${parsed.data.text}`,
      maxTokens: 2048
    });
    return NextResponse.json({ text: text.trim() });
  } catch (e) {
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    throw e;
  }
});
