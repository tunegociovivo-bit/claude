import { cleanupEditorialPostFiles } from "@/lib/content/cleanup";

export const dynamic = "force-dynamic";
/**
 * POST /api/v1/editorial/posts/[id]/regenerate
 *
 * Regenera una publicación existente: copy + image_prompt + headlines
 * + imagen. Útil cuando un post quedó mal en la generación masiva y
 * quieres "tirar otra moneda" sin abrir el modal de edición ni regenerar
 * el mes entero.
 *
 * Reutiliza generateMonth en modo singleTopic con el título actual del
 * post y borra/sustituye el contenido. Es un job background.
 *
 * Body opcional: { extraGuidance?, imageIncludeHint?, imageAvoidHint? }
 * para dirigir la nueva versión.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { generateMonth } from "@/lib/editorial/generate-month";
import { AIDisabledError } from "@/lib/ai/anthropic";
import { humanizeAiError } from "@/lib/ai/errors";
import { ensureContentBrand } from "@/lib/content/brand";

const schema = z.object({
  extraGuidance: z.string().optional(),
  imageIncludeHint: z.string().optional(),
  imageAvoidHint: z.string().optional(),
  useRosterPersons: z.array(z.string()).optional(),
  imageQuality: z.enum(["low", "medium", "high"]).default("medium")
});

export const POST = withApi({ module: "editorial", rate: "ai" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const post = await prisma.editorialPost.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    include: { client: true }
  });
  if (!post) throw new ApiError(404, "not_found", "Publicación no encontrada");
  // CRM: la regeneración usa siempre la ficha de marca del negocio.
  const brand = await ensureContentBrand(api.workspaceId);

  const job = await prisma.backgroundJob.create({
    data: {
      workspaceId: api.workspaceId,
      userId: api.userId ?? null,
      kind: "editorial.regenerate_post",
      status: "PENDING",
      progressPct: 0,
      progressMsg: "En cola…",
      request: { postId: post.id, ...parsed.data } as any
    }
  });

  regenerateAsync(
    job.id,
    api.workspaceId,
    api.userId ?? null,
    post.id,
    post.title,
    post.format ?? "imagen",
    JSON.parse(post.networks || '["instagram"]'),
    post.scheduledFor ?? new Date(),
    brand.id,
    parsed.data
  ).catch((e) => console.error("[regenerate-post] fallo crítico:", e));

  return NextResponse.json({ jobId: job.id }, { status: 202 });
});

async function regenerateAsync(
  jobId: string,
  workspaceId: string,
  userId: string | null,
  postId: string,
  title: string,
  format: string,
  networks: string[],
  scheduledFor: Date,
  clientId: string,
  hints: z.infer<typeof schema>
) {
  const t0 = Date.now();
  const events: any[] = [];
  const pushEvent = async (level: "info" | "warn" | "error", message: string) => {
    events.push({ ts: Date.now() - t0, level, message });
    await prisma.backgroundJob.update({ where: { id: jobId }, data: { events: events as any } }).catch(() => {});
  };
  try {
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date(), progressMsg: "Llamando a Claude…", progressPct: 10 }
    });
    await pushEvent("info", "Regenerando publicación…");

    // Se genera PRIMERO la publicación nueva (mismo título, formato, fecha y
    // redes); la antigua solo se sustituye si la generación termina bien, para
    // no perder nada si la IA falla.
    await pushEvent("info", "Llamando a Claude para el nuevo contenido…");

    const month = scheduledFor.toISOString().slice(0, 7);
    const result = await generateMonth({
      workspaceId,
      userId,
      jobId,
      clientId,
      month,
      count: 1,
      networks,
      copyLength: 50,
      perNetworkCopy: networks.length > 1,
      extraGuidance: hints.extraGuidance,
      status: "DRAFT",
      generateImages: true,
      imageQuality: hints.imageQuality,
      singleTopic: title,
      // Al regenerar, la publicación antigua no cuenta como contenido repetido
      // (se sustituye cuando la nueva esté lista).
      excludePostIds: [postId],
      singleFormat: format,
      singleScheduledFor: scheduledFor,
      imageIncludeHint: hints.imageIncludeHint,
      imageAvoidHint: hints.imageAvoidHint,
      useRosterPersons: hints.useRosterPersons,
      onProgress: async (msg, pct) => {
        await prisma.backgroundJob.update({ where: { id: jobId }, data: { progressMsg: msg, progressPct: pct } }).catch(() => {});
        await pushEvent("info", msg);
      }
    });

    if (!result.count) throw new Error("La IA no devolvió ninguna publicación; se conserva la anterior.");
    // Si la antigua ya tuvo envíos a Meta (publicados o en duda), se archiva
    // para conservar su historial; si no, se borra con sus archivos.
    const sent = await prisma.editorialPublication.count({ where: { postId, workspaceId, status: { in: ["PUBLISHED", "PUBLISHING", "UNKNOWN"] } } });
    if (sent > 0) {
      await prisma.$transaction([
        prisma.editorialPublication.updateMany({ where: { postId, workspaceId, status: { in: ["PENDING", "SCHEDULED", "FAILED"] } }, data: { status: "CANCELLED", scheduledFor: null } }),
        prisma.editorialPost.updateMany({ where: { id: postId, workspaceId }, data: { status: "ARCHIVED" } }),
      ]);
      await pushEvent("info", "Publicación anterior archivada (ya tenía envíos a Meta).");
    } else {
      const removed = await prisma.editorialPost.deleteMany({ where: { id: postId, workspaceId } });
      if (removed.count) void cleanupEditorialPostFiles(workspaceId, postId);
      await pushEvent("info", "Publicación anterior sustituida.");
    }

    const summary = result.imagesGenerated > 0
      ? "✓ Regenerado · imagen lista"
      : result.imagesFailed > 0
        ? "✓ Texto regenerado · imagen falló"
        : "✓ Regenerado";
    await pushEvent("info", summary);
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        progressPct: 100,
        progressMsg: summary,
        result: result as any,
        systemPrompt: result.systemPrompt ?? null,
        userPrompt: result.userPrompt ?? null
      }
    });
  } catch (e: any) {
    let code = "ai_error";
    let message = e?.message ?? "Error";
    if (e instanceof AIDisabledError) code = "ai_disabled";
    else {
      const h = humanizeAiError(e);
      code = h.code;
      message = h.message;
    }
    await pushEvent("error", message);
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorCode: code,
        errorMessage: message,
        progressMsg: `Error: ${message.slice(0, 100)}`
      }
    });
  }
}
