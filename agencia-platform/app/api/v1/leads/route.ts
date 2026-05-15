import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("contactStatus") ?? undefined;
  const urgency = url.searchParams.get("urgency") ?? undefined;
  const province = url.searchParams.get("province") ?? undefined;
  const searchId = url.searchParams.get("searchId") ?? undefined;
  const search = url.searchParams.get("search") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 500);

  const where: any = { workspaceId: api.workspaceId };
  if (status) where.contactStatus = status;
  if (urgency) where.urgency = urgency;
  if (province) where.province = province;
  if (searchId) where.searchId = searchId;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { province: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
      { website: { contains: search, mode: "insensitive" } }
    ];
  }

  const items = await prisma.lead.findMany({
    where,
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      name: true,
      province: true,
      phone: true,
      website: true,
      rating: true,
      reviewsCount: true,
      position: true,
      score: true,
      urgency: true,
      contactStatus: true,
      aiOpener: true,
      hasWhatsapp: true
    }
  });
  return NextResponse.json({ items });
});
