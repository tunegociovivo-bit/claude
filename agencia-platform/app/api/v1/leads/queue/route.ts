import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const where: any = { workspaceId: api.workspaceId };
  if (status) where.status = status;
  const items = await prisma.leadMessage.findMany({
    where,
    orderBy: [{ status: "asc" }, { scheduledAt: "asc" }],
    take: 200
  });
  return NextResponse.json({ items });
});
