/**
 * POST /api/v1/editorial/posts/[id]/adapt-format
 * Body: { format: imagen|reel|carrusel|story|video, quality?: low|medium|high }
 *
 * Wrapper sobre generateImageForPost que fuerza el formato (usa
 * dimensionesByFormat del cliente para el ratio) y opcionalmente cambia
 * el campo `format` del post al nuevo. Útil cuando tienes el feed en 4:5
 * y quieres también la versión Reel 9:16 sin perder la del feed.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { generateImageForPost } from "@/lib/editorial/generate-image";
import { AIDisabledError } from "@/lib/ai/anthropic";
import { humanizeAiError } from "@/lib/ai/errors";

const schema = z.object({
  format: z.enum(["imagen", "reel", "carrusel", "story", "video"]),
  quality: z.enum(["low", "medium", "high"]).default("medium"),
  changePostFormat: z.boolean().default(false)
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  try {
    const out = await generateImageForPost({
      workspaceId: api.workspaceId,
      userId: api.userId,
      postId: params.id,
      quality: parsed.data.quality,
      format: parsed.data.format
    });

    if (parsed.data.changePostFormat) {
      await prisma.editorialPost.update({
        where: { id: params.id },
        data: { format: parsed.data.format }
      });
    }

    return NextResponse.json({ ...out, format: parsed.data.format });
  } catch (e: any) {
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    if (e?.message === "Publicación no encontrada") throw new ApiError(404, "not_found", e.message);
    if (e?.message?.startsWith("Storage no configurado")) {
      throw new ApiError(503, "storage_disabled", e.message);
    }
    console.error("[adapt-format] error:", e);
    const h = humanizeAiError(e);
    throw new ApiError(500, h.code, h.message);
  }
});
