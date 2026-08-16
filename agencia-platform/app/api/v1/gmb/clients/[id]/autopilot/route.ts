/**
 * Política del piloto automático por ficha.
 *  GET  → política (o valores por defecto suggest_only).
 *  POST → crea/actualiza (modo, límite diario, quiet hours, confianza mínima, módulos, kill switch).
 * Tenant-scoped. Las acciones externas SIEMPRE requieren aprobación, sea cual sea el modo.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient } from "@/lib/gmb/server";

export const dynamic = "force-dynamic";

const schema = z.object({
  mode: z.enum(["suggest_only", "prepare_drafts", "execute_safe"]).optional(),
  dailyLimit: z.number().int().min(0).max(50).optional(),
  quietStart: z.number().int().min(0).max(23).nullable().optional(),
  quietEnd: z.number().int().min(0).max(23).nullable().optional(),
  minConfidence: z.number().int().min(0).max(100).optional(),
  allowedModules: z.array(z.string()).nullable().optional(),
  killSwitch: z.boolean().optional()
});

const DEFAULTS = { mode: "suggest_only", dailyLimit: 3, quietStart: null, quietEnd: null, minConfidence: 70, allowedModules: null, killSwitch: false };

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const p = await prisma.gmbAutopilotPolicy.findFirst({ where: { workspaceId: api.workspaceId, clientId: client.id } });
  return NextResponse.json({ ok: true, policy: p ?? { ...DEFAULTS, isDefault: true }, lastRunAt: p?.lastRunAt ?? null, executedToday: p?.executedToday ?? 0 });
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const existing = await prisma.gmbAutopilotPolicy.findFirst({ where: { workspaceId: api.workspaceId, clientId: client.id } });
  const data: any = {
    mode: parsed.data.mode ?? existing?.mode ?? DEFAULTS.mode,
    dailyLimit: parsed.data.dailyLimit ?? existing?.dailyLimit ?? DEFAULTS.dailyLimit,
    quietStart: parsed.data.quietStart !== undefined ? parsed.data.quietStart : existing?.quietStart ?? null,
    quietEnd: parsed.data.quietEnd !== undefined ? parsed.data.quietEnd : existing?.quietEnd ?? null,
    minConfidence: parsed.data.minConfidence ?? existing?.minConfidence ?? DEFAULTS.minConfidence,
    allowedModules: parsed.data.allowedModules !== undefined ? parsed.data.allowedModules : existing?.allowedModules ?? null,
    killSwitch: parsed.data.killSwitch ?? existing?.killSwitch ?? false
  };
  if (existing) await prisma.gmbAutopilotPolicy.updateMany({ where: { id: existing.id, workspaceId: api.workspaceId }, data });
  else await prisma.gmbAutopilotPolicy.create({ data: { workspaceId: api.workspaceId, clientId: client.id, createdById: api.userId ?? null, ...data } });
  // Mantén el modo espejado en la ficha (compatibilidad con la fase 1).
  await prisma.gmbClient.updateMany({ where: { id: client.id, workspaceId: api.workspaceId }, data: { autopilotMode: data.mode } });
  return NextResponse.json({ ok: true, policy: data });
});
