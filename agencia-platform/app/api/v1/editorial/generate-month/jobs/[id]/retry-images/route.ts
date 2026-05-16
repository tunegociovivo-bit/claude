/**
 * POST /api/v1/editorial/generate-month/jobs/[id]/retry-images
 *
 * Re-genera SOLO las imágenes que fallaron en el job original. Lee
 * result.failedImagePostIds del job, lanza un nuevo job en background
 * que llama a generateImageForPost de cada uno y reporta progreso.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const POST = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const original = await prisma.backgroundJob.findFirst({
    where: {
      id: params.id,
      workspaceId: api.workspaceId,
      kind: { in: ["editorial.generate_month", "editorial.generate_single"] }
    }
  });
  if (!original) throw new ApiError(404, "not_found", "Job no encontrado");

  const result = (original.result ?? {}) as any;
  const failedIds: string[] = Array.isArray(result?.failedImagePostIds)
    ? result.failedImagePostIds
    : [];
  if (failedIds.length === 0) {
    throw new ApiError(400, "no_failures", "Este job no tiene imágenes fallidas que reintentar.");
  }

  const requestParams = (original.request ?? {}) as any;
  const quality: "low" | "medium" | "high" =
    requestParams?.imageQuality === "low" || requestParams?.imageQuality === "high"
      ? requestParams.imageQuality
      : "medium";
  const useRosterPersons: string[] | undefined = Array.isArray(requestParams?.useRosterPersons)
    ? requestParams.useRosterPersons
    : undefined;

  const job = await prisma.backgroundJob.create({
    data: {
      workspaceId: api.workspaceId,
      userId: api.userId ?? null,
      kind: "editorial.retry_images",
      status: "PENDING",
      progressPct: 0,
      progressMsg: `En cola — reintentando ${failedIds.length} imágenes…`,
      request: { sourceJobId: original.id, postIds: failedIds, quality, useRosterPersons } as any
    }
  });

  retryImagesAsync(job.id, api.workspaceId, api.userId ?? null, failedIds, quality, useRosterPersons).catch(
    (e) => console.error("[retry-images] fallo crítico:", e)
  );

  return NextResponse.json({ jobId: job.id, count: failedIds.length }, { status: 202 });
});

async function retryImagesAsync(
  jobId: string,
  workspaceId: string,
  userId: string | null,
  postIds: string[],
  quality: "low" | "medium" | "high",
  useRosterPersons?: string[]
) {
  const t0 = Date.now();
  const events: any[] = [];
  const pushEvent = async (level: "info" | "warn" | "error", message: string) => {
    events.push({ ts: Date.now() - t0, level, message });
    await prisma.backgroundJob
      .update({ where: { id: jobId }, data: { events: events as any } })
      .catch(() => {});
  };
  try {
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date(), progressMsg: "Reintentando imágenes…", progressPct: 5 }
    });
    const { generateImageForPost } = await import("@/lib/editorial/generate-image");
    let ok = 0;
    let fail = 0;
    const stillFailed: string[] = [];
    for (let i = 0; i < postIds.length; i++) {
      const fresh = await prisma.backgroundJob
        .findUnique({ where: { id: jobId }, select: { cancelRequested: true } })
        .catch(() => null);
      if (fresh?.cancelRequested) {
        await pushEvent("warn", `Cancelado por el usuario en imagen ${i + 1}/${postIds.length}`);
        break;
      }
      const pct = 5 + Math.floor(((i + 1) / postIds.length) * 90);
      await prisma.backgroundJob
        .update({ where: { id: jobId }, data: { progressMsg: `Reintentando ${i + 1}/${postIds.length}…`, progressPct: pct } })
        .catch(() => {});
      try {
        await generateImageForPost({ workspaceId, userId, postId: postIds[i], quality, forceRosterPersons: useRosterPersons });
        ok++;
        await pushEvent("info", `Imagen ${i + 1}/${postIds.length} ✓`);
      } catch (e: any) {
        fail++;
        stillFailed.push(postIds[i]);
        await pushEvent("error", `Imagen ${i + 1}/${postIds.length} falló: ${String(e?.message ?? e).slice(0, 200)}`);
      }
    }
    const summary = `✓ ${ok} regeneradas${fail > 0 ? ` · ${fail} siguen fallando` : ""}`;
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        progressPct: 100,
        progressMsg: summary,
        result: { imagesGenerated: ok, imagesFailed: fail, failedImagePostIds: stillFailed } as any
      }
    });
  } catch (e: any) {
    await pushEvent("error", String(e?.message ?? e));
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorCode: "retry_failed",
        errorMessage: String(e?.message ?? e),
        progressMsg: "Error al reintentar"
      }
    });
  }
}
