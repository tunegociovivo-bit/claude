import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { effectiveFeatures } from "@/lib/features";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!api.userId) {
    return NextResponse.json({ userId: null, workspaceId: api.workspaceId });
  }
  const user = await prisma.user.findUnique({
    where: { id: api.userId },
    select: { id: true, name: true, email: true, image: true, phone: true, role: true }
  });
  const membership = await prisma.membership.findFirst({
    where: { userId: api.userId, workspaceId: api.workspaceId }
  });
  const role = (membership?.role as "ADMIN" | "MEMBER" | "GUEST" | undefined) ?? null;
  const features = role ? effectiveFeatures(role, (membership as any)?.features ?? null) : [];
  return NextResponse.json({
    user,
    role,
    features,
    workspaceId: api.workspaceId
  });
});
