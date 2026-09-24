import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { signedDownloadUrl } from "@/lib/storage/r2";
import { prependMediaUrl, parseMediaUrls, mediaIdentity } from "@/lib/editorial/media";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const post = await prisma.editorialPost.findFirst({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!post) throw new ApiError(404, "not_found", "Publicación no encontrada");
  const versions = await prisma.editorialMediaVersion.findMany({
    where: { postId: params.id, workspaceId: api.workspaceId }, orderBy: { createdAt: "asc" }
  });
  const currentVideo = parseMediaUrls(post.mediaUrls).find(url => /\.mp4(?:\?|$)/i.test(url));
  return NextResponse.json({ versions: await Promise.all(versions.map(async (v) => ({
    ...v, url: v.s3Key ? await signedDownloadUrl(v.s3Key) : v.url,
    selected: mediaIdentity(v.url) === mediaIdentity((v.kind === "video" ? currentVideo : post.thumbnail) ?? "")
  }))) });
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const parsed = z.object({ versionId: z.string().min(1) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", "Selecciona una versión");
  const version = await prisma.editorialMediaVersion.findFirst({
    where: { id: parsed.data.versionId, postId: params.id, workspaceId: api.workspaceId }
  });
  if (!version) throw new ApiError(404, "not_found", "Versión no encontrada");
  const post = await prisma.editorialPost.findFirst({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!post) throw new ApiError(404, "not_found", "Publicación no encontrada");
  const url = version.s3Key ? await signedDownloadUrl(version.s3Key) : version.url;
  await prisma.$transaction([
    prisma.editorialPost.update({ where: { id: post.id }, data: {
      ...(version.kind === "image" ? { thumbnail: version.url } : {}),
      mediaUrls: prependMediaUrl(post.mediaUrls, url)
    } }),
    prisma.editorialRevision.create({ data: {
      postId: post.id, authorId: api.userId ?? null,
      changeSummary: version.kind === "image" ? "Versión de imagen seleccionada" : "Versión de vídeo seleccionada",
      body: JSON.stringify({ versionId: version.id, before: { thumbnail: post.thumbnail, mediaUrls: post.mediaUrls }, selectedUrl: version.url })
    } })
  ]);
  return NextResponse.json({ url, kind: version.kind, versionId: version.id });
});
