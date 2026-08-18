/**
 * Reglas de alerta configurables. GET → reglas del workspace. POST → crea/actualiza una regla
 * (por ficha o global). webhookUrl es adapter-gated (si se define, se notifica de verdad). Tenant.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

const ALERT_TYPES = ["unreplied_reviews", "broken_citation", "ranking_drop", "content_stale", "connection_down", "negative_review"] as const;
const schema = z.object({
  clientId: z.string().nullable().optional(),
  type: z.enum(ALERT_TYPES),
  enabled: z.boolean().optional(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  threshold: z.number().int().min(0).max(3650).nullable().optional(),
  webhookUrl: z.string().url().nullable().optional()
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const rules = await prisma.gmbAlertRule.findMany({ where: { workspaceId: api.workspaceId }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ ok: true, rules, types: ALERT_TYPES });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  // Si es por ficha, valida pertenencia al workspace.
  if (parsed.data.clientId) {
    const c = await prisma.gmbClient.findFirst({ where: { id: parsed.data.clientId, workspaceId: api.workspaceId }, select: { id: true } });
    if (!c) throw new ApiError(404, "not_found", "Ficha no encontrada");
  }
  const existing = await prisma.gmbAlertRule.findFirst({ where: { workspaceId: api.workspaceId, clientId: parsed.data.clientId ?? null, type: parsed.data.type } });
  const data: any = {
    enabled: parsed.data.enabled ?? existing?.enabled ?? true,
    severity: parsed.data.severity ?? existing?.severity ?? "warning",
    threshold: parsed.data.threshold !== undefined ? parsed.data.threshold : existing?.threshold ?? null,
    webhookUrl: parsed.data.webhookUrl !== undefined ? parsed.data.webhookUrl : existing?.webhookUrl ?? null
  };
  if (existing) await prisma.gmbAlertRule.updateMany({ where: { id: existing.id, workspaceId: api.workspaceId }, data });
  else await prisma.gmbAlertRule.create({ data: { workspaceId: api.workspaceId, clientId: parsed.data.clientId ?? null, type: parsed.data.type, createdById: api.userId ?? null, ...data } });
  return NextResponse.json({ ok: true });
});
