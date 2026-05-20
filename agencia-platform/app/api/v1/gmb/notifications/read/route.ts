/**
 * POST /api/v1/gmb/notifications/read → marca como leída
 * Body: { id } para una, o {} para todas.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : null;
  if (id) {
    await prisma.gmbNotification.updateMany({
      where: { id, workspaceId: api.workspaceId },
      data: { isRead: true }
    });
  } else {
    await prisma.gmbNotification.updateMany({
      where: { workspaceId: api.workspaceId, isRead: false },
      data: { isRead: true }
    });
  }
  return NextResponse.json({ ok: true });
});
