/**
 * Generación de VÍDEO para publicaciones del calendario editorial.
 *
 * Reutiliza el MISMO contexto de marca que generate-image (brandBrief +
 * styleGuideCached + brandColors + copy del post + imagePrompt
 * estructurado si existe) — las instrucciones que David afinó durante
 * horas para que los reels/vídeos salgan a su gusto viven en esos
 * campos del cliente, así que el vídeo hereda el mismo "look".
 *
 * Motor: fal.ai (https://fal.ai) que hace de proxy a los mejores
 * modelos de vídeo (Veo 3, Kling, Luma, etc.). Una sola API key
 * (FAL_KEY) da acceso a todos. El modelo se elige con FAL_VIDEO_MODEL
 * (default kling v2 text-to-video, buen equilibrio calidad/precio).
 *
 * Flujo async (los modelos de vídeo tardan 1-5 min):
 *   1. POST a la cola de fal → request_id
 *   2. Polling del status hasta COMPLETED (o timeout)
 *   3. Descargar el .mp4 resultante, subir a R2, adjuntar al post
 *
 * Si FAL_KEY no está configurado, lanza error claro — el caller lo
 * reporta al user para que lo añada en Railway env.
 */

import { prisma } from "@/lib/db/prisma";
import { isStorageEnabled, uploadBuffer, signedDownloadUrl, buildS3Key } from "@/lib/storage/r2";
import { logAiUsage } from "@/lib/ai/usage";
import { getOpenAiKeyForWorkspace } from "@/lib/ai/openai";
import { generateFreepikKlingVideo } from "@/lib/ai/freepik";
import { completeJson } from "@/lib/ai/anthropic";

/** Genera una imagen de toma con gpt-image-2 (mismo motor que las imágenes
 *  de las publicaciones). Devuelve el Buffer PNG. */
async function generateShotImage(workspaceId: string, prompt: string, size: string): Promise<Buffer> {
  const apiKey = await getOpenAiKeyForWorkspace(workspaceId);
  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-2", prompt, size, n: 1, quality: "high" })
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`gpt-image-2 ${resp.status}: ${t.slice(0, 200)}`);
  }
  const j = await resp.json();
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image-2 no devolvió imagen");
  return Buffer.from(b64, "base64");
}

const STORYBOARD_SCHEMA = {
  type: "object",
  properties: {
    shots: {
      type: "array",
      items: {
        type: "object",
        properties: {
          image_prompt: { type: "string", description: "Prompt EN INGLÉS para gpt-image-2 de la toma (escena, sujeto, ambiente, luz)" },
          motion: { type: "string", description: "Movimiento de cámara/sujeto para animar la toma (corto, EN INGLÉS)" }
        },
        required: ["image_prompt", "motion"]
      }
    }
  },
  required: ["shots"]
};

/**
 * Construye el prompt de vídeo a partir del contexto de marca + copy.
 * Mismo enfoque que generate-image pero con directivas de movimiento
 * (cámara, ritmo, duración) propias del vídeo.
 */
function buildVideoPrompt(opts: {
  postTitle: string;
  postContent?: string | null;
  storedImagePrompt?: string | null;
  brandBrief?: string | null;
  styleGuide?: string | null;
  brandColorPrimary?: string | null;
  brandColorAccent?: string | null;
  extraGuidance?: string | null;
  format?: string;
}): string {
  // Si hay imagePrompt estructurado (de generate-month, afinado por
  // David), lo usamos como base visual — ya describe sujeto, ambiente,
  // personas del roster, etc. Le añadimos directivas de movimiento.
  if (opts.storedImagePrompt && opts.storedImagePrompt.length > 50) {
    return [
      opts.storedImagePrompt,
      "",
      "=== MOVIMIENTO / VÍDEO ===",
      "Cinematic motion: smooth camera movement (slow push-in or gentle pan),",
      "natural subject movement, professional commercial pacing.",
      opts.format === "reel" || opts.format === "story"
        ? "Vertical 9:16 format, dynamic and scroll-stopping for Reels/Stories."
        : "Horizontal 16:9, polished brand video.",
      "Realistic lighting, no on-screen text (el copy va aparte)."
    ].join("\n");
  }

  const parts: string[] = [
    `Brand video for a social media post titled "${opts.postTitle}".`
  ];
  if (opts.brandBrief?.trim()) parts.push(`About the brand: ${opts.brandBrief.slice(0, 600)}.`);
  if (opts.styleGuide?.trim()) parts.push(`Brand style: ${opts.styleGuide.slice(0, 800)}.`);
  if (opts.brandColorPrimary) {
    parts.push(`Brand colors: primary ${opts.brandColorPrimary}${opts.brandColorAccent ? `, accent ${opts.brandColorAccent}` : ""}.`);
  }
  if (opts.postContent?.trim()) parts.push(`Topic / message: ${opts.postContent.slice(0, 300)}.`);
  if (opts.extraGuidance?.trim()) parts.push(`Extra direction: ${opts.extraGuidance.slice(0, 300)}.`);
  parts.push(
    "=== VIDEO DIRECTION ===",
    "Cinematic, professional commercial look. Smooth camera motion,",
    "natural subject movement, vivid brand-consistent color grade,",
    opts.format === "reel" || opts.format === "story"
      ? "vertical 9:16 for Reels/Stories, dynamic and scroll-stopping."
      : "horizontal 16:9 polished brand video.",
    "Realistic lighting. NO on-screen text or captions (el copy se añade aparte)."
  );
  return parts.filter(Boolean).join("\n");
}

export async function generatePostVideo(opts: {
  workspaceId: string;
  postId: string;
  /** Override del prompt base (si David quiere guiar el storyboard). */
  promptOverride?: string;
  /** Guidance extra del user para este vídeo concreto. */
  extraGuidance?: string;
  /** Slug del modelo de vídeo de Freepik (default kling-v2). */
  model?: string;
  /** Nº de tomas (default 2, máx 4). */
  shots?: number;
}): Promise<{ videoUrls: string[]; shots: number; note: string }> {
  if (!isStorageEnabled()) {
    throw new Error("STORAGE_* no configurado — no se pueden guardar vídeos generados");
  }

  const post = await prisma.editorialPost.findFirst({
    where: { id: opts.postId, workspaceId: opts.workspaceId },
    include: { client: true }
  });
  if (!post) throw new Error(`Post ${opts.postId} no existe en este workspace`);
  const client: any = post.client;

  const format = (post as any).format ?? "reel";
  const vertical = format === "reel" || format === "story";
  const imageSize = vertical ? "1024x1536" : "1536x1024";
  const aspectRatio = vertical ? "9:16" : "16:9";
  const nShots = Math.max(1, Math.min(opts.shots ?? 2, 4));

  const baseCtx = buildVideoPrompt({
    postTitle: post.title,
    postContent: post.content,
    storedImagePrompt: (post as any).imagePrompt,
    brandBrief: client?.brandBrief,
    styleGuide: client?.styleGuideCached,
    brandColorPrimary: client?.brandColorPrimary,
    brandColorAccent: client?.brandColorAccent,
    extraGuidance: opts.extraGuidance,
    format
  });

  // 1) Storyboard: dividir la publicación en N tomas (imagen + movimiento).
  let shots: { image_prompt: string; motion: string }[] = [];
  try {
    const sb = await completeJson<{ shots: { image_prompt: string; motion: string }[] }>({
      workspaceId: opts.workspaceId,
      system:
        `Eres director creativo de vídeo para redes sociales. Divide la publicación en ${nShots} TOMAS ` +
        `coherentes (storyboard). Para cada toma da un image_prompt EN INGLÉS detallado y listo para gpt-image-2 ` +
        `(escena, sujeto descrito físicamente sin nombres propios, ambiente, luz, encajado en ${aspectRatio}, ` +
        `SIN texto sobreimpreso) y un 'motion' corto en inglés (movimiento de cámara/sujeto). Mantén coherencia ` +
        `de marca y del MISMO personaje entre tomas.`,
      user: (opts.promptOverride?.trim() || baseCtx).slice(0, 6000),
      schema: STORYBOARD_SCHEMA,
      maxTokens: 2000,
      feature: "editorial_video_storyboard"
    } as any);
    shots = Array.isArray(sb?.shots) ? sb.shots.slice(0, nShots) : [];
  } catch {
    shots = [];
  }
  if (shots.length === 0) {
    shots = [{ image_prompt: baseCtx, motion: "slow cinematic push-in, natural subject movement" }];
  }

  // 2) Por cada toma: imagen con gpt-image-2 → vídeo con Freepik/Kling.
  const videoUrls: string[] = [];
  const imageUrls: string[] = [];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const imgBuf = await generateShotImage(opts.workspaceId, shot.image_prompt, imageSize);
    const imgKey = buildS3Key({
      workspaceId: opts.workspaceId,
      targetType: "editorial",
      targetId: post.id,
      filename: `shot-${i + 1}-${Date.now()}.png`
    });
    await uploadBuffer({ s3Key: imgKey, body: imgBuf, contentType: "image/png" });
    imageUrls.push(await signedDownloadUrl(imgKey));
    logAiUsage({
      workspaceId: opts.workspaceId,
      feature: "editorial_video_frame",
      provider: "openai",
      model: "gpt-image-2",
      inputTokens: 0,
      outputTokens: 0
    }).catch(() => {});

    const { url: clipUrl, model } = await generateFreepikKlingVideo({
      workspaceId: opts.workspaceId,
      imageBase64: imgBuf.toString("base64"),
      prompt: shot.motion || "cinematic motion",
      durationSeconds: 5,
      modelSlug: opts.model
    });
    const vresp = await fetch(clipUrl);
    if (!vresp.ok) throw new Error(`No pude descargar la toma ${i + 1}: ${vresp.status}`);
    const vbuf = Buffer.from(await vresp.arrayBuffer());
    const vKey = buildS3Key({
      workspaceId: opts.workspaceId,
      targetType: "editorial",
      targetId: post.id,
      filename: `video-shot-${i + 1}-${Date.now()}.mp4`
    });
    await uploadBuffer({ s3Key: vKey, body: vbuf, contentType: "video/mp4" });
    videoUrls.push(await signedDownloadUrl(vKey));
    logAiUsage({
      workspaceId: opts.workspaceId,
      feature: "editorial_video",
      provider: "freepik",
      model: `freepik:${model}`,
      inputTokens: 0,
      outputTokens: 0
    }).catch(() => {});
  }

  // 3) Adjuntar al post: primero los clips, luego las imágenes de cada toma.
  let mediaUrls: string[] = [];
  try {
    mediaUrls = JSON.parse(post.mediaUrls);
    if (!Array.isArray(mediaUrls)) mediaUrls = [];
  } catch {
    mediaUrls = [];
  }
  mediaUrls = [...videoUrls, ...imageUrls, ...mediaUrls];
  await prisma.editorialPost.update({
    where: { id: post.id },
    data: { mediaUrls: JSON.stringify(mediaUrls) }
  });

  return {
    videoUrls,
    shots: shots.length,
    note: `${shots.length} toma(s) ${aspectRatio}: imagen (gpt-image-2) → vídeo (Freepik/Kling). ${videoUrls.length} clip(s) adjuntado(s) al post.`
  };
}
