/**
 * POST /api/v1/editorial/posts/[id]/reapply-overlay
 * Body: { headlines?: string[], logoVisible?: boolean }
 *
 * Re-aplica el overlay (logo + headlines) sobre la imagen actual del
 * post, SIN re-generar con IA. Usa el thumbnail existente como base,
 * compone con sharp, sube la nueva imagen a R2 y la asocia al post.
 *
 * Mucho más rápido y barato que regenerar con OpenAI; útil para probar
 * variaciones de copy/colores rápidamente.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { composeOverlay } from "@/lib/editorial/overlay";
import { isStorageEnabled, uploadBuffer, signedDownloadUrl, buildS3Key } from "@/lib/storage/r2";
import { resignUrlLong } from "@/lib/storage/resign";

const schema = z.object({
  headlines: z.array(z.string()).max(3).optional(),
  logoVisible: z.boolean().default(true)
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  if (!isStorageEnabled()) {
    throw new ApiError(503, "storage_disabled", "Configura STORAGE_* para usar overlay");
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const post = await prisma.editorialPost.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    include: { client: true }
  });
  if (!post) throw new ApiError(404, "not_found", "Publicación no encontrada");
  if (!post.thumbnail) {
    throw new ApiError(400, "no_image", "El post no tiene imagen. Genera una primero.");
  }

  // Headlines: usuario las pasa, o derivamos del título + 1ª línea del copy
  let headlines = parsed.data.headlines;
  if (!headlines || headlines.length === 0) {
    const lines: string[] = [];
    if (post.title) lines.push(post.title);
    if (post.content) {
      const firstSentence = post.content.split(/[.!?\n]/)[0]?.trim();
      if (firstSentence && firstSentence !== post.title) lines.push(firstSentence.slice(0, 90));
    }
    headlines = lines.slice(0, 2);
  }

  // El thumbnail y el logo son URLs firmadas de R2 que caducan en 1h: re-firmar
  // antes de componer para que composeOverlay pueda descargarlas.
  const imageUrl = (await resignUrlLong(post.thumbnail).catch(() => null)) || post.thumbnail;
  const rawLogo = parsed.data.logoVisible ? post.client?.logoUrl ?? null : null;
  const logoUrl = rawLogo ? (await resignUrlLong(rawLogo).catch(() => null)) || rawLogo : null;

  try {
    const buf = await composeOverlay({
      imageUrl,
      logoUrl,
      logoPosition: (post.client?.logoPosition as any) ?? "br",
      headlines,
      primary: post.client?.brandColorPrimary,
      accent: post.client?.brandColorAccent,
      text: post.client?.brandColorText,
      pattern: ((post as any).visualPattern as any) ?? (post.client?.visualPattern as any) ?? "clean"
    });

    const s3Key = buildS3Key({
      workspaceId: api.workspaceId,
      targetType: "editorial",
      targetId: post.id,
      filename: `overlay-${Date.now()}.png`
    });
    await uploadBuffer({ s3Key, body: buf, contentType: "image/png" });
    const url = await signedDownloadUrl(s3Key);

    let mediaUrls: string[] = [];
    try {
      mediaUrls = JSON.parse(post.mediaUrls);
      if (!Array.isArray(mediaUrls)) mediaUrls = [];
    } catch {
      mediaUrls = [];
    }
    if (!mediaUrls.includes(url)) mediaUrls.unshift(url);

    await prisma.editorialPost.update({
      where: { id: post.id },
      data: { thumbnail: url, mediaUrls: JSON.stringify(mediaUrls) }
    });

    return NextResponse.json({ url, headlines, applied: true });
  } catch (e: any) {
    console.error("[reapply-overlay] error:", e);
    throw new ApiError(500, "overlay_error", e?.message ?? "Error componiendo overlay");
  }
});
