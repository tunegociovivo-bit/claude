/**
 * GET  /api/v1/admin/ai-agent/proactive
 * PUT  /api/v1/admin/ai-agent/proactive
 *
 * Lee y actualiza la config de proactividad de Sonia del workspace:
 *   enabled, deadlineHours (1-168), staleDays (1-60), maxRunsPerCron (1-25)
 *
 * Sólo admin.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";

const DEFAULTS = {
  enabled: false,
  deadlineHours: 48,
  staleDays: 7,
  maxRunsPerCron: 5
};

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const cfg = (ws?.settings as any)?.aiAgent?.proactive ?? {};
  return NextResponse.json({
    enabled: cfg.enabled === true,
    deadlineHours: cfg.deadlineHours ?? DEFAULTS.deadlineHours,
    staleDays: cfg.staleDays ?? DEFAULTS.staleDays,
    maxRunsPerCron: cfg.maxRunsPerCron ?? DEFAULTS.maxRunsPerCron
  });
});

const putSchema = z.object({
  enabled: z.boolean(),
  deadlineHours: z.number().int().min(1).max(168).optional(),
  staleDays: z.number().int().min(1).max(60).optional(),
  maxRunsPerCron: z.number().int().min(1).max(25).optional()
});

export const PUT = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = (ws?.settings as any) ?? {};
  if (!settings.aiAgent) {
    throw new ApiError(400, "not_initialized", "Sonia no está inicializada en este workspace. Inicialízala primero.");
  }
  settings.aiAgent.proactive = {
    enabled: parsed.data.enabled,
    deadlineHours: parsed.data.deadlineHours ?? DEFAULTS.deadlineHours,
    staleDays: parsed.data.staleDays ?? DEFAULTS.staleDays,
    maxRunsPerCron: parsed.data.maxRunsPerCron ?? DEFAULTS.maxRunsPerCron
  };
  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings }
  });
  return NextResponse.json({ ok: true, proactive: settings.aiAgent.proactive });
});
