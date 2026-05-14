import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";

export const GET = withApi({ scope: "admin" }, async (_req, { api }) => {
  const items = await prisma.asanaImport.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { startedAt: "desc" },
    take: 20
  });
  return NextResponse.json({ items });
});
