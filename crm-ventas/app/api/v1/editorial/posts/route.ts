import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { resignPostMedia } from "@/lib/storage/resign";
import { ensureContentBrand } from "@/lib/content/brand";
import { assertWorkspaceAssetUrl, assetUrlSchema } from "@/lib/editorial/assets";

const STATUSES = ["DRAFT", "REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"] as const;

const createSchema = z.object({
  // CRM: se ignora; la publicación siempre es de la marca del negocio.
  clientId: z.string().optional().nullable(),
  title: z.string().min(1).max(200),
  content: z.string().optional(),
  excerpt: z.string().optional(),
  scheduledFor: z.string().datetime().optional().nullable(),
  status: z.enum(STATUSES).default("DRAFT"),
  format: z.string().optional(),
  networks: z.array(z.string()).default([]),
  thumbnail: assetUrlSchema.optional(),
  mediaUrls: z.array(assetUrlSchema).max(30).default([]),
  copyByNetwork: z.record(z.string(), z.string()).nullable().optional(),
  hashtags: z.string().nullable().optional(),
  firstComment: z.string().nullable().optional(),
  // Aspect ratio elegido en el modal "Nueva publicación". Null/"auto" =
  // derivado del formato + ficha de la marca. Cualquier "W:H" (1:1, 16:9, …)
  // se respeta en la generación de imagen/vídeo.
  aspectRatio: z.string().optional().nullable()
});

export const GET = withApi({ module: "editorial" }, async (req, { api }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const month = url.searchParams.get("month"); // YYYY-MM

  const where: any = { workspaceId: api.workspaceId };
  if (status) where.status = status;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    where.scheduledFor = { gte: start, lt: end };
  }

  const items = await prisma.editorialPost.findMany({
    where,
    include: {
      client: { select: { id: true, name: true } },
      publications: { include: { profile: true }, orderBy: { updatedAt: "desc" } },
      mediaVersions: { orderBy: { createdAt: "desc" }, take: 20 },
      _count: { select: { revisions: true } }
    },
    orderBy: { scheduledFor: "asc" },
    take: 500
  });
  // Re-firma URLs caducadas. Paralelo para no serializar 500 firmas.
  const fresh = await Promise.all(items.map((p) => resignPostMedia(p)));
  return NextResponse.json({ items: fresh });
});

export const POST = withApi({ module: "editorial" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const brand = await ensureContentBrand(api.workspaceId);
  for (const url of [parsed.data.thumbnail, ...(parsed.data.mediaUrls ?? [])]) {
    if (url) await assertWorkspaceAssetUrl(url, api.workspaceId);
  }

  const created = await prisma.editorialPost.create({
    data: {
      workspaceId: api.workspaceId,
      clientId: brand.id,
      title: parsed.data.title,
      content: parsed.data.content ?? null,
      excerpt: parsed.data.excerpt ?? null,
      scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null,
      status: parsed.data.status,
      format: parsed.data.format ?? null,
      networks: JSON.stringify(parsed.data.networks ?? []),
      thumbnail: parsed.data.thumbnail ?? null,
      mediaUrls: JSON.stringify(parsed.data.mediaUrls ?? []),
      copyByNetwork: parsed.data.copyByNetwork ?? undefined,
      hashtags: parsed.data.hashtags ?? null,
      firstComment: parsed.data.firstComment ?? null,
      aspectRatio: parsed.data.aspectRatio ?? null
    }
  });
  return NextResponse.json(created, { status: 201 });
});
