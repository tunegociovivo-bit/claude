import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const createSchema = z.object({
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  location: z.string().optional(),
  googleUrl: z.string().url().optional().or(z.literal("")),
  trustpilotUrl: z.string().url().optional().or(z.literal("")),
  introText: z.string().optional(),
  disclaimer: z.string().optional(),
  customPrompt: z.string().optional(),
  maxSeconds: z.number().int().min(5).max(120).default(30),
  aiProvider: z.enum(["anthropic", "openai"]).default("anthropic")
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const items = await prisma.voiceBusiness.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" }
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const existing = await prisma.voiceBusiness.findUnique({
    where: { workspaceId_slug: { workspaceId: api.workspaceId, slug: parsed.data.slug } }
  });
  if (existing) throw new ApiError(409, "slug_taken", "Ya existe un negocio con ese slug");

  const created = await prisma.voiceBusiness.create({
    data: {
      workspaceId: api.workspaceId,
      slug: parsed.data.slug,
      name: parsed.data.name,
      location: parsed.data.location || null,
      googleUrl: parsed.data.googleUrl || null,
      trustpilotUrl: parsed.data.trustpilotUrl || null,
      introText: parsed.data.introText || null,
      disclaimer: parsed.data.disclaimer || null,
      customPrompt: parsed.data.customPrompt || null,
      maxSeconds: parsed.data.maxSeconds,
      aiProvider: parsed.data.aiProvider
    }
  });
  return NextResponse.json(created, { status: 201 });
});
