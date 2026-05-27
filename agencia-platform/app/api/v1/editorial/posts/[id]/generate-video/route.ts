/**
 * POST /api/v1/editorial/posts/[id]/generate-video
 * Body: { promptOverride?, extraGuidance?, model? }
 *
 * Genera un vídeo (reel/story/video) reutilizando el brief + estilo +
 * colores del cliente. Lo sube a R2 y lo adjunta al post.
 *
 * Async largo (1-5 min): el endpoint espera al resultado. maxDuration
 * alto para que Vercel/Railway no corte.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { generatePostVideo } from "@/lib/editorial/generate-video";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const schema = z.object({
  promptOverride: z.string().optional(),
  extraGuidance: z.string().optional(),
  model: z.string().optional(),
  shots: z.number().int().min(1).max(4).optional(),
  voiceover: z.boolean().optional(),
  subtitles: z.boolean().optional()
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  try {
    const out = await generatePostVideo({
      workspaceId: api.workspaceId,
      postId: params.id,
      promptOverride: parsed.data.promptOverride,
      extraGuidance: parsed.data.extraGuidance,
      model: parsed.data.model,
      shots: parsed.data.shots,
      voiceover: parsed.data.voiceover,
      subtitles: parsed.data.subtitles
    });
    return NextResponse.json(out);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes("FAL_KEY")) {
      throw new ApiError(503, "fal_not_configured", msg);
    }
    if (msg.includes("no existe")) throw new ApiError(404, "not_found", msg);
    if (msg.includes("STORAGE")) throw new ApiError(503, "storage_disabled", msg);
    throw new ApiError(502, "video_failed", msg.slice(0, 300));
  }
});
