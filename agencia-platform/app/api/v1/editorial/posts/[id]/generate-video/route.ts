/**
 * POST /api/v1/editorial/posts/[id]/generate-video
 * Body: { promptOverride?, extraGuidance?, model? }
 *
 * Genera un vídeo (reel/story/video) reutilizando el brief + estilo +
 * colores del cliente. Lo sube a R2 y lo adjunta al post.
 *
 * El editor solicita async:true y consulta GET para mantener el progreso
 * aunque se cierre el diálogo, sin una petición HTTP abierta varios minutos.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { generatePostVideo } from "@/lib/editorial/generate-video";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const schema = z.object({
  promptOverride: z.string().optional(),
  extraGuidance: z.string().optional(),
  model: z.string().optional(),
  shots: z.number().int().min(1).max(4).optional(),
  voiceover: z.boolean().optional(),
  subtitles: z.boolean().optional(),
  useCurrentImage: z.boolean().optional(),
  async: z.boolean().optional(),
  durationSeconds: z.union([z.literal(5), z.literal(10)]).optional(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]).optional(),
  style: z.string().trim().max(500).optional()
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const post = await prisma.editorialPost.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true } });
  if (!post) throw new ApiError(404, "not_found", "Publicación no encontrada");
  if (parsed.data.async) {
    const job = await prisma.$transaction(async tx => {
      // Serialize requests for this post, including across server replicas.
      await tx.$queryRaw`SELECT id FROM "EditorialPost" WHERE id = ${params.id} FOR UPDATE`;
      const existing = await tx.backgroundJob.findFirst({ where: {
        workspaceId: api.workspaceId, kind: "editorial.generate_video",
        status: { in: ["PENDING", "RUNNING"] }, request: { path: ["postId"], equals: params.id }
      } });
      if (existing) return { job: existing, start: false };
      const created = await tx.backgroundJob.create({ data: {
        workspaceId: api.workspaceId, userId: api.userId ?? null, kind: "editorial.generate_video",
        status: "PENDING", progressPct: 0, progressMsg: "Preparando vídeo…", request: { ...parsed.data, postId: params.id }
      } });
      return { job: created, start: true };
    });
    if (job.start) void runVideoJob(job.job.id, api.workspaceId, params.id, parsed.data).catch(e => console.error("[editorial-video] No se pudo actualizar el trabajo", e));
    return NextResponse.json({ jobId: job.job.id, status: job.job.status }, { status: 202 });
  }

  try {
    let useCurrentImage = false;
    if (parsed.data.useCurrentImage) {
      const post = await prisma.editorialPost.findFirst({
        where: { id: params.id, workspaceId: api.workspaceId },
        select: { thumbnail: true }
      });
      useCurrentImage = Boolean(post?.thumbnail);
    }
    const out = await generatePostVideo({
      workspaceId: api.workspaceId,
      postId: params.id,
      promptOverride: parsed.data.promptOverride,
      extraGuidance: parsed.data.extraGuidance,
      model: parsed.data.model,
      shots: parsed.data.shots,
      voiceover: parsed.data.voiceover,
      subtitles: parsed.data.subtitles,
      useCurrentImage,
      durationSeconds: parsed.data.durationSeconds,
      aspectRatio: parsed.data.aspectRatio,
      style: parsed.data.style
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

async function runVideoJob(jobId: string, workspaceId: string, postId: string, options: z.infer<typeof schema>) {
  try {
    await prisma.backgroundJob.update({ where: { id: jobId }, data: { status: "RUNNING", startedAt: new Date(), progressPct: 10, progressMsg: "Creando vídeo. Puede tardar varios minutos…" } });
    const result = await generatePostVideo({ ...options, workspaceId, postId });
    await prisma.backgroundJob.update({ where: { id: jobId }, data: { status: "COMPLETED", completedAt: new Date(), progressPct: 100, progressMsg: "Vídeo creado y guardado en el historial", result: result as any } });
  } catch (e) {
    await prisma.backgroundJob.update({ where: { id: jobId }, data: { status: "FAILED", completedAt: new Date(), errorCode: "video_failed", errorMessage: (e instanceof Error ? e.message : String(e)).slice(0, 500), progressMsg: "No se pudo completar el vídeo" } });
  }
}

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  let job = await prisma.backgroundJob.findFirst({ where: {
    workspaceId: api.workspaceId, kind: "editorial.generate_video", request: { path: ["postId"], equals: params.id }
  }, orderBy: { createdAt: "desc" } });
  // An interrupted deployment must not leave the editor permanently disabled.
  if (job && ["PENDING", "RUNNING"].includes(job.status) && Date.now() - job.createdAt.getTime() > 60 * 60 * 1000) {
    await prisma.backgroundJob.updateMany({ where: { id: job.id, status: { in: ["PENDING", "RUNNING"] } }, data: { status: "FAILED", completedAt: new Date(), errorMessage: "La generación se interrumpió o superó una hora. Puedes reintentarlo." } });
    job = await prisma.backgroundJob.findUnique({ where: { id: job.id } });
  }
  return NextResponse.json({ job: job ? { id: job.id, status: job.status, message: job.progressMsg, error: job.errorMessage } : null });
});
