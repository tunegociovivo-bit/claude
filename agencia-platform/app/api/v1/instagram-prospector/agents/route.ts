import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*", admin: true, rate: "admin" }, async (_req, { api }) => {
  const onlineSince = new Date(Date.now() - 2 * 60 * 1000);
  const agents = await prisma.instagramProspectorAgent.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { lastHeartbeatAt: "desc" },
    take: 5,
    select: { id: true, agentKey: true, label: true, version: true, lastHeartbeatAt: true }
  });
  return NextResponse.json({
    onlineAgents: agents.filter((agent) => agent.lastHeartbeatAt >= onlineSince).length,
    agents: agents.map((agent) => ({
      id: agent.id,
      label: agent.label,
      version: agent.version,
      lastHeartbeatAt: agent.lastHeartbeatAt,
      online: agent.lastHeartbeatAt >= onlineSince,
      keyTail: agent.agentKey.slice(-6)
    }))
  });
});
