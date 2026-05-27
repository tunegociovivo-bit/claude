import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  location: z.string().optional(),
  googleUrl: z.string().url().optional().or(z.literal("")),
  trustpilotUrl: z.string().url().optional().or(z.literal("")),
  introText: z.string().optional(),
  disclaimer: z.string().optional(),
  customPrompt: z.string().optional(),
  maxSeconds: z.number().int().min(5).max(120).optional(),
  aiProvider: z.enum(["anthropic", "openai"]).optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const data: any = { ...parsed.data };
  for (const k of ["location", "googleUrl", "trustpilotUrl", "introText", "disclaimer", "customPrompt"] as const) {
    if (data[k] === "") data[k] = null;
  }
  const result = await prisma.voiceBusiness.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId },
    data
  });
  if (result.count === 0) throw new ApiError(404, "not_found", "Negocio no encontrado");
  return NextResponse.json(await prisma.voiceBusiness.findUnique({ where: { id: params.id } }));
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const result = await prisma.voiceBusiness.deleteMany({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (result.count === 0) throw new ApiError(404, "not_found", "Negocio no encontrado");
  return NextResponse.json({ ok: true });
});
