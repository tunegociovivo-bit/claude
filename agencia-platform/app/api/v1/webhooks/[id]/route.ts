import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { auditFromReq } from "@/lib/audit/log";
import { dispatchWebhookSync, WEBHOOK_EVENTS } from "@/lib/webhooks/dispatch";

const patchSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS as any)).min(1).optional(),
  active: z.boolean().optional()
});

export const PATCH = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const updated = await prisma.webhook.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId },
    data: parsed.data
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Webhook no encontrado");
  auditFromReq(req, api, {
    action: "webhook.update",
    targetType: "WEBHOOK",
    targetId: params.id,
    after: parsed.data
  });
  return NextResponse.json(await prisma.webhook.findUnique({ where: { id: params.id } }));
});

export const DELETE = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const del = await prisma.webhook.deleteMany({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (del.count === 0) throw new ApiError(404, "not_found", "Webhook no encontrado");
  auditFromReq(req, api, {
    action: "webhook.delete",
    targetType: "WEBHOOK",
    targetId: params.id
  });
  return NextResponse.json({ ok: true });
});

/** POST /api/v1/webhooks/[id]?action=test → dispara un evento de prueba */
export const POST = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const url = new URL(req.url);
  if (url.searchParams.get("action") !== "test") {
    throw new ApiError(400, "invalid_action", "Acción no soportada");
  }
  const hook = await prisma.webhook.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!hook) throw new ApiError(404, "not_found", "Webhook no encontrado");
  await dispatchWebhookSync(api.workspaceId, hook.events[0] ?? "task.created", {
    test: true,
    message: "Evento de prueba desde el panel admin",
    triggeredBy: api.userId
  });
  return NextResponse.json({ ok: true });
});
