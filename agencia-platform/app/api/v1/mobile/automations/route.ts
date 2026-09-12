import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { loadMobileAutomationAccess } from "@/lib/mobile/automation-access";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const { canManage } = await loadMobileAutomationAccess(api.workspaceId, api.userId);
  const deviceSerial = new URL(req.url).searchParams.get("deviceSerial")?.trim();
  const jobs = await prisma.mobileAutomationJob.findMany({
    where: {
      workspaceId: api.workspaceId,
      ...(deviceSerial ? { deviceSerial } : {})
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      phoneKey: true,
      deviceSerial: true,
      platform: true,
      action: true,
      targetUrl: true,
      text: true,
      facts: true,
      sourceKind: true,
      sourceRef: true,
      status: true,
      scheduledAt: true,
      attempts: true,
      maxAttempts: true,
      lastErrorCode: true,
      lastError: true,
      preparedAt: true,
      completedAt: true,
      approvedAt: true,
      createdAt: true,
      updatedAt: true
    }
  });
  const policy = await prisma.mobileAutomationPolicy.findUnique({
    where: { workspaceId: api.workspaceId }
  });
  return NextResponse.json({ canManage, jobs, policy });
});

