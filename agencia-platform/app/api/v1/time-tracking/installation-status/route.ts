import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

const RECENT_AGENT_DAYS = 45;

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "unauthenticated", "Usuario no identificado");

  const since = new Date(Date.now() - RECENT_AGENT_DAYS * 24 * 60 * 60 * 1000);

  const [session, screenshot, activity] = await Promise.all([
    prisma.timeTrackerSession.findFirst({
      where: {
        workspaceId: api.workspaceId,
        userId: api.userId,
        source: "AGENT",
        startedAt: { gte: since }
      },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.timeTrackerScreenshot.findFirst({
      where: {
        workspaceId: api.workspaceId,
        userId: api.userId,
        capturedAt: { gte: since }
      },
      select: { id: true, capturedAt: true },
      orderBy: { capturedAt: "desc" }
    }),
    prisma.timeTrackerActivity.findFirst({
      where: {
        workspaceId: api.workspaceId,
        userId: api.userId,
        bucketStart: { gte: since },
        deviceId: { not: "" }
      },
      select: { id: true, bucketStart: true },
      orderBy: { bucketStart: "desc" }
    })
  ]);

  const installed = Boolean(session || screenshot || activity);
  const lastSeenAt = session?.updatedAt ?? screenshot?.capturedAt ?? activity?.bucketStart ?? null;

  return NextResponse.json({
    installed,
    detectable: installed,
    checkedWindowDays: RECENT_AGENT_DAYS,
    lastSeenAt,
    source: session ? "agent_session" : screenshot ? "screenshot" : activity ? "activity" : null
  });
});
