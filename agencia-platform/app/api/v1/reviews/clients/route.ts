import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const reviewClientCreate = z.object({
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, "El slug debe ser minúsculas, números y guiones"),
  name: z.string().min(1).max(120),
  webUrl: z.string().url().optional().or(z.literal("")),
  destinationUrl: z.string().url(),
  topics: z.string().min(1),
  bannedWords: z.string().optional(),
  recommendedWords: z.string().optional(),
  extraInstructions: z.string().optional(),
  model: z.enum(["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"]).default("gpt-4o-mini")
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const items = await prisma.reviewClient.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" }
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = reviewClientCreate.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const existing = await prisma.reviewClient.findUnique({
    where: { workspaceId_slug: { workspaceId: api.workspaceId, slug: parsed.data.slug } }
  });
  if (existing) throw new ApiError(409, "slug_taken", "Ya existe un cliente con ese slug");

  const created = await prisma.reviewClient.create({
    data: {
      workspaceId: api.workspaceId,
      slug: parsed.data.slug,
      name: parsed.data.name,
      webUrl: parsed.data.webUrl || null,
      destinationUrl: parsed.data.destinationUrl,
      topics: parsed.data.topics,
      bannedWords: parsed.data.bannedWords || null,
      recommendedWords: parsed.data.recommendedWords || null,
      extraInstructions: parsed.data.extraInstructions || null,
      model: parsed.data.model
    }
  });
  return NextResponse.json(created, { status: 201 });
});
