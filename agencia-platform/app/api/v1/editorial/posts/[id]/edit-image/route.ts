/**
 * POST /api/v1/editorial/posts/[id]/edit-image
 * Body: { prompt, quality? }
 *
 * Modifica la imagen ACTUAL del post (img2img con gpt-image-2) según la
 * instrucción libre del usuario, conservando composición, marca y texto.
 * La imagen editada se sube a R2 y sustituye al thumbnail.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { editImageForPost } from "@/lib/editorial/generate-image";
import { AIDisabledError } from "@/lib/ai/anthropic";
import { humanizeAiError } from "@/lib/ai/errors";

const schema = z.object({
  prompt: z.string().trim().min(3, "Escribe qué quieres cambiar de la imagen"),
  quality: z.enum(["low", "medium", "high"]).default("medium")
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  try {
    const out = await editImageForPost({
      workspaceId: api.workspaceId,
      userId: api.userId,
      postId: params.id,
      prompt: parsed.data.prompt,
      quality: parsed.data.quality
    });
    return NextResponse.json(out);
  } catch (e: any) {
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    if (e?.message === "Publicación no encontrada") throw new ApiError(404, "not_found", e.message);
    if (e?.message?.includes("no tiene imagen todavía")) {
      throw new ApiError(409, "no_image", e.message);
    }
    if (e?.message?.startsWith("Storage no configurado")) {
      throw new ApiError(503, "storage_disabled", e.message);
    }
    console.error("[edit-image] error:", e);
    const h = humanizeAiError(e);
    throw new ApiError(500, h.code, h.message);
  }
});
