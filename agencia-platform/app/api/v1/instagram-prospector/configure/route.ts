import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { completeJson, AIDisabledError } from "@/lib/ai/anthropic";
import { promptInputSchema, promptConfigSchema, promptOutputJsonSchema, PROMPT_CONFIG_SYSTEM, validatePromptSources } from "@/lib/instagram-prospector/prompt-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi({ scope: "ai", admin: true, rate: "ai" }, async (req, { api }) => {
  const input = promptInputSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) throw new ApiError(400, "validation_error", "Describe tu busqueda con entre 10 y 4000 caracteres.");
  try {
    const generated = await completeJson<unknown>({
      workspaceId: api.workspaceId, userId: api.userId, feature: "instagram_prospector_configure",
      system: PROMPT_CONFIG_SYSTEM, user: input.data.prompt,
      schema: promptOutputJsonSchema, maxTokens: 2000
    });
    const result = promptConfigSchema.safeParse(generated);
    if (!result.success || !validatePromptSources(result.data, input.data.prompt)) {
      throw new ApiError(502, "invalid_ai_config", "La IA no ha devuelto una configuracion valida. Indica una cuenta @usuario o una URL concreta y vuelve a intentarlo.");
    }
    const notice = !result.data.target
      ? "Falta indicar la URL o cuenta de origen para esta busqueda."
      : result.data.target.includes("#") ? "Los hashtags propuestos son sugerencias; su disponibilidad se comprobara durante la busqueda." : "Formulario actualizado.";
    return NextResponse.json({ config: result.data, notice });
  } catch (error) {
    if (error instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", error.message);
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "configuration_failed", "No se pudo preparar el formulario con IA. Puedes volver a intentarlo; los campos anteriores se han conservado.");
  }
});
