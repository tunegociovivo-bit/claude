import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { eventCreateSchema } from "@/lib/api/schemas";

export const GET = withApi({ scope: "events:read" }, async (req, { api }) => {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const where: any = { workspaceId: api.workspaceId };
  if (from || to) {
    where.startAt = {};
    if (from) where.startAt.gte = new Date(from);
    if (to) where.startAt.lte = new Date(to);
  }
  const items = await prisma.calendarEvent.findMany({
    where,
    include: { client: { select: { id: true, name: true } } },
    orderBy: { startAt: "asc" }
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "events:write" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = eventCreateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const ev = await prisma.calendarEvent.create({
    data: {
      ...parsed.data,
      startAt: new Date(parsed.data.startAt),
      endAt: parsed.data.endAt ? new Date(parsed.data.endAt) : undefined,
      workspaceId: api.workspaceId
    }
  });
  return NextResponse.json(ev, { status: 201 });
});
