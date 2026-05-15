/**
 * POST /api/v1/editorial/posts/[id]/generate-image
 * Body: { quality?, promptOverride?, format? }
 *
 * Genera una imagen con gpt-image-1 usando el brief + colores + guía de
 * estilo del cliente. La sube a R2 y la asocia al post como thumbnail.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { generateImageForPost } from "@/lib/editorial/generate-image";
import { AIDisabledError } from "@/lib/ai/anthropic";

const schema = z.object({
  quality: z.enum(["low", "medium", "high"]).default("medium"),
  promptOverride: z.string().optional(),
  format: z.enum(["imagen", "reel", "carrusel", "story", "video"]).optional()
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  try {
    const out = await generateImageForPost({
      workspaceId: api.workspaceId,
      userId: api.userId,
      postId: params.id,
      ...parsed.data
    });
    return NextResponse.json(out);
  } catch (e: any) {
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    if (e?.message === "Publicación no encontrada") throw new ApiError(404, "not_found", e.message);
    if (e?.message?.startsWith("Storage no configurado")) {
      throw new ApiError(503, "storage_disabled", e.message);
    }
    console.error("[generate-image] error:", e);
    throw new ApiError(500, "image_error", e?.message ?? "Error generando imagen");
  }
});
