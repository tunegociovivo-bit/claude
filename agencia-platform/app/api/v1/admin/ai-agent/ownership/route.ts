/**
 * GET  /api/v1/admin/ai-agent/ownership          → lista ownerships activos
 * POST /api/v1/admin/ai-agent/ownership          → crea/actualiza ownership
 *      body: { clientId, kpis, checkFreqDays?, active? }
 *
 * Owner mode (Fase 31): pones clientes "bajo responsabilidad" de NV IA
 * con KPIs medibles. El cron /api/cron/ai-agent/owner-check dispara
 * revisiones periódicas.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const items = await prisma.aiOwnership.findMany({
    where: { workspaceId: api.workspaceId },
    include: { client: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" }
  });
  return NextResponse.json({ items });
});

const upsertSchema = z.object({
  clientId: z.string(),
  kpis: z.record(z.any()).default({}),
  checkFreqDays: z.number().int().min(1).max(60).optional(),
  active: z.boolean().optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const c = await prisma.client.findFirst({
    where: { id: parsed.data.clientId, workspaceId: api.workspaceId }
  });
  if (!c) throw new ApiError(404, "not_found", "Cliente no encontrado");

  const item = await prisma.aiOwnership.upsert({
    where: { clientId: parsed.data.clientId },
    create: {
      workspaceId: api.workspaceId,
      clientId: parsed.data.clientId,
      kpis: parsed.data.kpis,
      checkFreqDays: parsed.data.checkFreqDays ?? 7,
      active: parsed.data.active ?? true
    },
    update: {
      kpis: parsed.data.kpis,
      ...(parsed.data.checkFreqDays ? { checkFreqDays: parsed.data.checkFreqDays } : {}),
      ...(typeof parsed.data.active === "boolean" ? { active: parsed.data.active } : {})
    }
  });
  return NextResponse.json({ ok: true, item });
});
