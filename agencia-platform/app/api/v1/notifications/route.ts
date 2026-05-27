import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");

  const url = new URL(req.url);
  const onlyUnread = url.searchParams.get("unread") === "true";

  const where: any = { userId: api.userId };
  if (onlyUnread) where.read = false;

  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50
    }),
    prisma.notification.count({ where: { userId: api.userId, read: false } })
  ]);

  return NextResponse.json({ items, unreadCount });
});

export const PATCH = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  // Marca todas como leídas
  const result = await prisma.notification.updateMany({
    where: { userId: api.userId, read: false },
    data: { read: true }
  });
  return NextResponse.json({ ok: true, marked: result.count });
});
