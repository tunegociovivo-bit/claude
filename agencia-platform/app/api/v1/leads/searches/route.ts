import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const createSchema = z.object({
  keyword: z.string().min(2).max(120),
  location: z.string().min(2).max(120),
  provincesScope: z.array(z.string()).default([])
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const items = await prisma.leadSearch.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { leads: true } } },
    take: 200
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const created = await prisma.leadSearch.create({
    data: {
      workspaceId: api.workspaceId,
      keyword: parsed.data.keyword,
      location: parsed.data.location,
      provincesScope: JSON.stringify(parsed.data.provincesScope ?? []),
      status: "PENDING"
    }
  });
  return NextResponse.json(created, { status: 201 });
});
