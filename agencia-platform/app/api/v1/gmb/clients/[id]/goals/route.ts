/**
 * Objetivos por ficha y métrica. GET → objetivos. POST → crea/actualiza (upsert por métrica).
 * Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient } from "@/lib/gmb/server";

export const dynamic = "force-dynamic";

const schema = z.object({ metric: z.enum(["calls", "requests", "clicks", "directions"]), target: z.number().int().min(0).max(100000), period: z.string().max(20).optional() });

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const goals = await prisma.gmbGoal.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, orderBy: { metric: "asc" } });
  return NextResponse.json({ ok: true, goals });
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const existing = await prisma.gmbGoal.findFirst({ where: { workspaceId: api.workspaceId, clientId: client.id, metric: parsed.data.metric } });
  if (existing) await prisma.gmbGoal.updateMany({ where: { id: existing.id, workspaceId: api.workspaceId }, data: { target: parsed.data.target, period: parsed.data.period ?? existing.period } });
  else await prisma.gmbGoal.create({ data: { workspaceId: api.workspaceId, clientId: client.id, metric: parsed.data.metric, target: parsed.data.target, period: parsed.data.period ?? "month", createdById: api.userId ?? null } });
  return NextResponse.json({ ok: true });
});
