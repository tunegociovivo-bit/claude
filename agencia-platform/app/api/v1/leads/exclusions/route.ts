import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const items = await prisma.leadExclusion.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" }
  });
  return NextResponse.json({ items });
});

const createSchema = z.object({
  matchType: z.enum(["name"]).default("name"),
  matchValue: z.string().min(1),
  matchMode: z.enum(["contains", "exact"]).default("contains"),
  reason: z.string().optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const item = await prisma.leadExclusion.create({
    data: {
      workspaceId: api.workspaceId,
      matchType: parsed.data.matchType,
      matchValue: parsed.data.matchValue,
      matchMode: parsed.data.matchMode,
      reason: parsed.data.reason ?? null
    }
  });
  return NextResponse.json(item, { status: 201 });
});
