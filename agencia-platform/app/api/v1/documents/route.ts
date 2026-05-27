import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { documentCreateSchema } from "@/lib/api/schemas";

export const GET = withApi({ scope: "docs:read" }, async (_req, { api }) => {
  const items = await prisma.document.findMany({
    where: { workspaceId: api.workspaceId, archived: false },
    orderBy: { updatedAt: "desc" }
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "docs:write" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = documentCreateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const doc = await prisma.document.create({ data: { ...parsed.data, workspaceId: api.workspaceId } });
  return NextResponse.json(doc, { status: 201 });
});
