/**
 * Webhooks salientes — CRUD para que el admin configure URLs a las
 * que enviar eventos cuando pasan cosas en su workspace.
 *
 * GET    /api/v1/webhooks → lista
 * POST   /api/v1/webhooks { url, events[] } → crea (secret generado)
 */

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { auditFromReq } from "@/lib/audit/log";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/dispatch";

const createSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS as any)).min(1)
});

export const GET = withApi({ scope: "tasks:read" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const items = await prisma.webhook.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { deliveries: true } }
    }
  });
  return NextResponse.json({ items, knownEvents: WEBHOOK_EVENTS });
});

export const POST = withApi({ scope: "tasks:write" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const secret = crypto.randomBytes(32).toString("hex");
  const hook = await prisma.webhook.create({
    data: {
      workspaceId: api.workspaceId,
      url: parsed.data.url,
      secret,
      events: parsed.data.events
    }
  });
  auditFromReq(req, api, {
    action: "webhook.create",
    targetType: "WEBHOOK",
    targetId: hook.id,
    after: { url: hook.url, events: hook.events }
  });
  return NextResponse.json(hook, { status: 201 });
});
