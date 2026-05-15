import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  webUrl: z.string().url().optional().or(z.literal("")),
  destinationUrl: z.string().url().optional(),
  topics: z.string().min(1).optional(),
  bannedWords: z.string().optional(),
  recommendedWords: z.string().optional(),
  extraInstructions: z.string().optional(),
  model: z.enum(["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"]).optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const result = await prisma.reviewClient.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId },
    data: { ...parsed.data, webUrl: parsed.data.webUrl || null }
  });
  if (result.count === 0) throw new ApiError(404, "not_found", "Cliente no encontrado");

  return NextResponse.json(await prisma.reviewClient.findUnique({ where: { id: params.id } }));
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const result = await prisma.reviewClient.deleteMany({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (result.count === 0) throw new ApiError(404, "not_found", "Cliente no encontrado");
  return NextResponse.json({ ok: true });
});
