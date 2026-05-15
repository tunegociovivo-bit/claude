import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!api.userId) {
    return NextResponse.json({ userId: null, workspaceId: api.workspaceId });
  }
  const user = await prisma.user.findUnique({
    where: { id: api.userId },
    select: { id: true, name: true, email: true, image: true, role: true }
  });
  const membership = await prisma.membership.findFirst({
    where: { userId: api.userId, workspaceId: api.workspaceId }
  });
  return NextResponse.json({
    user,
    role: membership?.role ?? null,
    workspaceId: api.workspaceId
  });
});
