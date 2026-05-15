import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const STATUSES = ["DRAFT", "REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"] as const;

const createSchema = z.object({
  clientId: z.string().optional(),
  title: z.string().min(1).max(200),
  content: z.string().optional(),
  excerpt: z.string().optional(),
  scheduledFor: z.string().datetime().optional().nullable(),
  status: z.enum(STATUSES).default("DRAFT"),
  format: z.string().optional(),
  networks: z.array(z.string()).default([]),
  thumbnail: z.string().url().optional(),
  mediaUrls: z.array(z.string().url()).default([])
});

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const clientId = url.searchParams.get("clientId") ?? undefined;
  const month = url.searchParams.get("month"); // YYYY-MM

  const where: any = { workspaceId: api.workspaceId };
  if (status) where.status = status;
  if (clientId) where.clientId = clientId;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    where.scheduledFor = { gte: start, lt: end };
  }

  const items = await prisma.editorialPost.findMany({
    where,
    include: { client: { select: { id: true, name: true } }, _count: { select: { revisions: true } } },
    orderBy: { scheduledFor: "asc" },
    take: 500
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const created = await prisma.editorialPost.create({
    data: {
      workspaceId: api.workspaceId,
      clientId: parsed.data.clientId ?? null,
      title: parsed.data.title,
      content: parsed.data.content ?? null,
      excerpt: parsed.data.excerpt ?? null,
      scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null,
      status: parsed.data.status,
      format: parsed.data.format ?? null,
      networks: JSON.stringify(parsed.data.networks ?? []),
      thumbnail: parsed.data.thumbnail ?? null,
      mediaUrls: JSON.stringify(parsed.data.mediaUrls ?? [])
    }
  });
  return NextResponse.json(created, { status: 201 });
});
