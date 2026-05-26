import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { resignPostMedia } from "@/lib/storage/resign";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const STATUSES = ["DRAFT", "REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"] as const;

const updateSchema = z.object({
  clientId: z.string().nullable().optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  excerpt: z.string().optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  publishedAt: z.string().datetime().nullable().optional(),
  status: z.enum(STATUSES).optional(),
  format: z.string().optional(),
  networks: z.array(z.string()).optional(),
  thumbnail: z.string().url().nullable().optional(),
  mediaUrls: z.array(z.string().url()).optional(),
  // Copy distinto por red — { instagram: "...", facebook: "...", ... }
  copyByNetwork: z.record(z.string(), z.string()).nullable().optional(),
  hashtags: z.string().nullable().optional(),
  firstComment: z.string().nullable().optional(),
  // Patrón visual por publicación + intensidad (0-100) con que la IA lo
  // aplica al generar la imagen.
  visualPattern: z.string().nullable().optional(),
  patternStrength: z.number().int().min(0).max(100).nullable().optional(),
  patternTemplateId: z.string().nullable().optional(),
  // Aspect ratio elegido por el usuario para la generación de imagen/vídeo.
  aspectRatio: z.string().nullable().optional(),
  changeSummary: z.string().optional() // si se incluye, se crea revisión
});

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const post = await prisma.editorialPost.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    include: {
      client: { select: { id: true, name: true } },
      revisions: { orderBy: { createdAt: "desc" } }
    }
  });
  if (!post) throw new ApiError(404, "not_found", "Publicación no encontrada");
  // Re-firma URLs caducadas (R2 expira a 1h). Las URLs persistidas
  // en thumbnail/mediaUrls se refrescan al vuelo.
  const fresh = await resignPostMedia(post);
  return NextResponse.json(fresh);
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const existing = await prisma.editorialPost.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!existing) throw new ApiError(404, "not_found", "Publicación no encontrada");

  const data: any = {};
  if (parsed.data.clientId !== undefined) data.clientId = parsed.data.clientId;
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.content !== undefined) data.content = parsed.data.content;
  if (parsed.data.excerpt !== undefined) data.excerpt = parsed.data.excerpt;
  if (parsed.data.scheduledFor !== undefined)
    data.scheduledFor = parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null;
  if (parsed.data.publishedAt !== undefined)
    data.publishedAt = parsed.data.publishedAt ? new Date(parsed.data.publishedAt) : null;
  if (parsed.data.status !== undefined) data.status = parsed.data.status;
  if (parsed.data.format !== undefined) data.format = parsed.data.format;
  if (parsed.data.networks !== undefined) data.networks = JSON.stringify(parsed.data.networks);
  if (parsed.data.thumbnail !== undefined) data.thumbnail = parsed.data.thumbnail;
  if (parsed.data.mediaUrls !== undefined) data.mediaUrls = JSON.stringify(parsed.data.mediaUrls);
  if (parsed.data.copyByNetwork !== undefined) data.copyByNetwork = parsed.data.copyByNetwork;
  if (parsed.data.hashtags !== undefined) data.hashtags = parsed.data.hashtags;
  if (parsed.data.firstComment !== undefined) data.firstComment = parsed.data.firstComment;
  if (parsed.data.visualPattern !== undefined) data.visualPattern = parsed.data.visualPattern;
  if (parsed.data.patternStrength !== undefined) data.patternStrength = parsed.data.patternStrength;
  if (parsed.data.patternTemplateId !== undefined) data.patternTemplateId = parsed.data.patternTemplateId;
  if (parsed.data.aspectRatio !== undefined) data.aspectRatio = parsed.data.aspectRatio;

  const result = await prisma.$transaction(async (tx) => {
    const upd = await tx.editorialPost.update({ where: { id: params.id }, data });
    if (parsed.data.changeSummary || parsed.data.content) {
      await tx.editorialRevision.create({
        data: {
          postId: params.id,
          authorId: api.userId ?? null,
          body: parsed.data.content ?? existing.content,
          changeSummary: parsed.data.changeSummary ?? null
        }
      });
    }
    return upd;
  });
  return NextResponse.json(result);
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const del = await prisma.editorialPost.deleteMany({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (del.count === 0) throw new ApiError(404, "not_found", "Publicación no encontrada");
  return NextResponse.json({ ok: true });
});
