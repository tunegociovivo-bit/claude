import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("contactStatus") ?? undefined;
  const search = url.searchParams.get("search") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);

  const where: any = { workspaceId: api.workspaceId };
  if (status) where.contactStatus = status;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
      { website: { contains: search, mode: "insensitive" } }
    ];
  }

  const items = await prisma.lead.findMany({
    where,
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take: limit
  });
  return NextResponse.json({ items });
});
