import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const items = await prisma.leadOptout.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 500
  });
  return NextResponse.json({ items });
});

const createSchema = z.object({
  phone: z.string().min(1),
  reason: z.string().optional(),
  leadId: z.string().optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const item = await prisma.leadOptout.upsert({
    where: { workspaceId_phone: { workspaceId: api.workspaceId, phone: parsed.data.phone } },
    create: {
      workspaceId: api.workspaceId,
      phone: parsed.data.phone,
      reason: parsed.data.reason ?? null,
      leadId: parsed.data.leadId ?? null,
      source: "manual"
    },
    update: { reason: parsed.data.reason ?? null }
  });
  return NextResponse.json(item, { status: 201 });
});
