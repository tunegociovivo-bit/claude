import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  body: z.string().min(1).max(4000),
  channel: z.enum(["whatsapp", "email", "sms"]).default("whatsapp"),
  isDefault: z.boolean().default(false)
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const items = await prisma.leadTemplate.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" }
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const created = await prisma.leadTemplate.create({
    data: { workspaceId: api.workspaceId, ...parsed.data }
  });
  return NextResponse.json(created, { status: 201 });
});
