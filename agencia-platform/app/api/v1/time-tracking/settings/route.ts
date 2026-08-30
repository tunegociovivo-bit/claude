import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const schema = z.object({ enabledUserIds: z.array(z.string().min(1)).max(500) });
export const dynamic = "force-dynamic";

export const PATCH = withApi({ scope: "admin", admin: true }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const members = await prisma.membership.findMany({ where: { workspaceId: api.workspaceId }, select: { userId: true } });
  const memberIds = new Set(members.map((member) => member.userId));
  if (parsed.data.enabledUserIds.some((id) => !memberIds.has(id))) {
    throw new ApiError(400, "invalid_members", "Hay trabajadores que no pertenecen a esta empresa");
  }
  const enabled = new Set(parsed.data.enabledUserIds);
  await prisma.$transaction(members.map((member) => prisma.timeTrackerPolicy.upsert({
    where: { userId: member.userId },
    create: { workspaceId: api.workspaceId, userId: member.userId, trackingEnabled: enabled.has(member.userId) },
    update: { trackingEnabled: enabled.has(member.userId) }
  })));
  return NextResponse.json({ ok: true, enabled: enabled.size, excluded: members.length - enabled.size });
});
