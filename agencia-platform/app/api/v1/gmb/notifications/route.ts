/**
 * GET /api/v1/gmb/notifications → últimas notificaciones + contador no leídas
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const [items, unread] = await Promise.all([
    prisma.gmbNotification.findMany({
      where: { workspaceId: api.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 50
    }),
    prisma.gmbNotification.count({ where: { workspaceId: api.workspaceId, isRead: false } })
  ]);
  return NextResponse.json({ items, unread });
});
