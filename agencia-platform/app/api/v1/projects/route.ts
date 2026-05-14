import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { projectCreateSchema } from "@/lib/api/schemas";

export const GET = withApi({ scope: "projects:read" }, async (req, { api }) => {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") ?? undefined;
  const where: any = { workspaceId: api.workspaceId, archived: false };
  if (clientId) where.clientId = clientId;
  const items = await prisma.project.findMany({
    where,
    include: { client: { select: { id: true, name: true } }, _count: { select: { tasks: true } } },
    orderBy: { createdAt: "desc" }
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "projects:write" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = projectCreateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const project = await prisma.project.create({ data: { ...parsed.data, workspaceId: api.workspaceId } });
  return NextResponse.json(project, { status: 201 });
});
