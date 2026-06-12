import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const onlyUnread = url.searchParams.get("unread") === "true";
  const where: any = { workspaceId: api.workspaceId };
  if (onlyUnread) where.read = false;
  const [items, ws] = await Promise.all([
    prisma.leadInboxMessage.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      include: { lead: { select: { id: true, name: true, phone: true } } },
      take: 200
    }),
    prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } })
  ]);
  const leadsCfg: any = (ws?.settings as any)?.leads ?? {};
  return NextResponse.json({
    items,
    diagnostics: {
      webhookLastHit: leadsCfg.webhookLastHit ?? null,
      webhookLastEvent: leadsCfg.webhookLastEvent ?? null,
      webhookLastDecision: leadsCfg.webhookLastDecision ?? null,
      webhookLastFrom: leadsCfg.webhookLastFrom ?? null,
      webhookLastBody: leadsCfg.webhookLastBody ?? null,
      webhookLastKeys: leadsCfg.webhookLastKeys ?? null
    }
  });
});
