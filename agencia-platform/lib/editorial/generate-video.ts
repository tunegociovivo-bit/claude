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

const FAL_QUEUE_BASE = "https://queue.fal.run";
const DEFAULT_MODEL = "fal-ai/kling-video/v2/master/text-to-video";
const POLL_INTERVAL_MS = 6000;
const POLL_TIMEOUT_MS = 6 * 60 * 1000; // 6 min

async function getFalKey(workspaceId: string): Promise<string> {
  // Prioridad: workspace settings (cifrado) → env var. Así el user
  // puede configurarlo desde la plataforma sin tocar Railway.
  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true }
    });
    const enc = (ws?.settings as any)?.integrations?.fal?.apiKeyEnc;
    if (enc) {
      const { decryptSecret } = await import("@/lib/ai/crypto");
      const plain = decryptSecret(enc);
      if (plain) return plain;
    }
  } catch {
    // sigue al fallback de env
  }
  const key = process.env.FAL_KEY ?? process.env.FAL_API_KEY ?? "";
  if (!key) {
    throw new Error(
      "FAL_KEY no configurada. Pégala en /admin/editorial (sección Vídeo IA) o en Railway env. Consíguela en https://fal.ai/dashboard/keys."
    );
  }
  return key;
}

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

async function falQueueSubmit(model: string, key: string, input: Record<string, unknown>): Promise<string> {
  const r = await fetch(`${FAL_QUEUE_BASE}/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`fal.ai submit ${r.status}: ${t.slice(0, 300)}`);
  }
  const data = await r.json();
  const id = data?.request_id ?? data?.requestId;
  if (!id) throw new Error("fal.ai no devolvió request_id");
  return id;
}

async function falQueuePoll(model: string, key: string, requestId: string): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const sr = await fetch(`${FAL_QUEUE_BASE}/${model}/requests/${requestId}/status`, {
      headers: { Authorization: `Key ${key}` }
    });
    if (sr.ok) {
      const s = await sr.json();
      const status = s?.status;
      if (status === "COMPLETED") {
        // Obtener el resultado final
        const rr = await fetch(`${FAL_QUEUE_BASE}/${model}/requests/${requestId}`, {
          headers: { Authorization: `Key ${key}` }
        });
        if (!rr.ok) throw new Error(`fal.ai result ${rr.status}`);
        const result = await rr.json();
        // fal devuelve { video: { url } } o { video_url } según modelo
        const url =
          result?.video?.url ??
          result?.video_url ??
          result?.output?.video?.url ??
          (Array.isArray(result?.videos) ? result.videos[0]?.url : null);
        if (!url) throw new Error("fal.ai COMPLETED pero sin URL de vídeo en el resultado");
        return url;
      }
      if (status === "FAILED" || status === "ERROR") {
        throw new Error(`fal.ai generación falló: ${JSON.stringify(s).slice(0, 300)}`);
      }
    }
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
  }
  throw new Error(`fal.ai timeout tras ${POLL_TIMEOUT_MS / 1000}s — el vídeo tarda demasiado`);
}

export async function generatePostVideo(opts: {
  workspaceId: string;
  postId: string;
  /** Override del prompt (si David quiere uno manual). */
  promptOverride?: string;
  /** Guidance extra del user para este vídeo concreto. */
  extraGuidance?: string;
  /** Modelo fal.ai (default kling v2). */
  model?: string;
}): Promise<{ videoUrl: string; durationNote: string }> {
  if (!isStorageEnabled()) {
    throw new Error("STORAGE_* no configurado — no se pueden guardar vídeos generados");
  }
  const key = await getFalKey(opts.workspaceId);
  const model = opts.model ?? process.env.FAL_VIDEO_MODEL ?? DEFAULT_MODEL;

  const post = await prisma.editorialPost.findFirst({
    where: { id: opts.postId, workspaceId: opts.workspaceId },
    include: { client: true }
  });
  if (!post) throw new Error(`Post ${opts.postId} no existe en este workspace`);
  const client: any = post.client;

  const format = (post as any).format ?? "reel";
  const prompt =
    opts.promptOverride?.trim() ||
    buildVideoPrompt({
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

  // Aspect ratio según formato
  const aspectRatio = format === "reel" || format === "story" ? "9:16" : "16:9";

  // Submit + poll
  const requestId = await falQueueSubmit(model, key, {
    prompt,
    aspect_ratio: aspectRatio,
    duration: "5" // 5s — suficiente para reel; algunos modelos aceptan "10"
  });
  const remoteUrl = await falQueuePoll(model, key, requestId);

  // Descargar el mp4 y subir a R2
  const vidResp = await fetch(remoteUrl);
  if (!vidResp.ok) throw new Error(`No pude descargar el vídeo generado: ${vidResp.status}`);
  const buf = Buffer.from(await vidResp.arrayBuffer());
  const s3Key = buildS3Key({
    workspaceId: opts.workspaceId,
    targetType: "editorial",
    targetId: post.id,
    filename: `video-${Date.now()}.mp4`
  });
  await uploadBuffer({ s3Key, body: buf, contentType: "video/mp4" });
  const url = await signedDownloadUrl(s3Key);

  // Adjuntar al post: añadimos a mediaUrls + marcamos thumbnail si no hay
  let mediaUrls: string[] = [];
  try {
    mediaUrls = JSON.parse(post.mediaUrls);
    if (!Array.isArray(mediaUrls)) mediaUrls = [];
  } catch {
    mediaUrls = [];
  }
  mediaUrls.unshift(url);
  await prisma.editorialPost.update({
    where: { id: post.id },
    data: { mediaUrls: JSON.stringify(mediaUrls) }
  });

  logAiUsage({
    workspaceId: opts.workspaceId,
    feature: "editorial_video",
    provider: "freepik", // fal no está en el enum; usamos freepik como "otro media"
    model: `fal:${model}`,
    inputTokens: 0,
    outputTokens: 0
  }).catch(() => {});

  return {
    videoUrl: url,
    durationNote: `Vídeo ${aspectRatio} generado con ${model} (~5s). Adjuntado al post.`
  };
}
