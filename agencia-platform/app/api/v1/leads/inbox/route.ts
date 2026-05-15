import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const onlyUnread = url.searchParams.get("unread") === "true";
  const where: any = { workspaceId: api.workspaceId };
  if (onlyUnread) where.read = false;
  const items = await prisma.leadInboxMessage.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    include: { lead: { select: { id: true, name: true, phone: true } } },
    take: 200
  });
  return NextResponse.json({ items });
});
