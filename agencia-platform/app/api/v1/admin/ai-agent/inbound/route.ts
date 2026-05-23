/**
 * GET  /api/v1/admin/ai-agent/inbound  → lee config + URL del webhook
 * PUT  /api/v1/admin/ai-agent/inbound  → activa/desactiva
 *                                         body: { email?: {enabled}, whatsapp?: {enabled} }
 * POST /api/v1/admin/ai-agent/inbound/regenerate-email-token →
 *      genera token aleatorio nuevo para el endpoint inbound-email
 *
 * Sólo admin.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

function originOf(req: { url: string }): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL;
  if (base) return base.replace(/\/+$/, "");
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const cfg = (ws?.settings as any)?.aiAgent?.inbound ?? {};
  const origin = originOf(req);
  const callToken = cfg.call?.webhookToken ?? null;
  return NextResponse.json({
    email: {
      enabled: cfg.email?.enabled === true,
      webhookToken: cfg.email?.webhookToken ?? null
    },
    whatsapp: {
      enabled: cfg.whatsapp?.enabled === true
    },
    call: {
      enabled: cfg.call?.enabled === true,
      webhookToken: callToken,
      webhookUrl: callToken ? `${origin}/api/webhooks/inbound-call/${callToken}` : null
    }
  });
});

const putSchema = z.object({
  email: z.object({ enabled: z.boolean() }).optional(),
  whatsapp: z.object({ enabled: z.boolean() }).optional(),
  call: z
    .object({
      enabled: z.boolean(),
      // Token a medida opcional: si se pasa, se usa ese exacto (útil para
      // reaprovechar una URL ya configurada en Make). Si no, se genera/mantiene.
      webhookToken: z.string().trim().min(16).max(100).regex(/^[A-Za-z0-9._-]+$/).optional()
    })
    .optional()
});

export const PUT = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = (ws?.settings as any) ?? {};
  if (!settings.aiAgent) {
    throw new ApiError(400, "not_initialized", "Sonia no está inicializada");
  }
  settings.aiAgent.inbound = settings.aiAgent.inbound ?? {};
  if (parsed.data.email) {
    settings.aiAgent.inbound.email = {
      enabled: parsed.data.email.enabled,
      // Si se está activando email Y no hay token, generamos uno.
      webhookToken:
        settings.aiAgent.inbound.email?.webhookToken ??
        (parsed.data.email.enabled ? randomBytes(24).toString("hex") : null)
    };
  }
  if (parsed.data.whatsapp) {
    settings.aiAgent.inbound.whatsapp = { enabled: parsed.data.whatsapp.enabled };
  }
  if (parsed.data.call) {
    settings.aiAgent.inbound.call = {
      enabled: parsed.data.call.enabled,
      // Prioridad: token a medida (si se pasa) > token existente > generado.
      webhookToken:
        parsed.data.call.webhookToken ??
        settings.aiAgent.inbound.call?.webhookToken ??
        (parsed.data.call.enabled ? randomBytes(24).toString("hex") : null)
    };
  }
  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings }
  });
  return NextResponse.json({ ok: true, inbound: settings.aiAgent.inbound });
});
