/**
 * GET /api/v1/admin/sonia-client-scores
 *
 * Score 0-100 por cliente con el "trust" hacia Sonia: si está alto y
 * sostenido, ese cliente está listo para modo autopilot (Sonia decide
 * sin pedir aprobación en acciones de riesgo medio).
 *
 * Fórmula transparente:
 *   - 40 pts × successRate (succeeded / cerrados)
 *   - 25 pts × ahorro coste medio (25 si <\$0.05/run, 0 si >\$0.50)
 *   - 20 pts × baja intervención humana (20 si requires_human=0%, 0 si >50%)
 *   - 15 pts × volumen (5 runs = 8, 20+ runs = 15)
 *
 * El frontend pinta:
 *   - 0-49: rojo "no autonomous"
 *   - 50-79: ámbar "supervisado"
 *   - 80-100: verde "ready for autopilot"
 *
 * El flag autopilot se setea manualmente en Client.settings.aiAgent.
 * autonomous (no automático — la decisión final es del admin).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-7": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 0.8, output: 4 }
};
function costUsd(model: string | null, inTok: number, outTok: number): number {
  const p = PRICING[model ?? "claude-opus-4-7"];
  return (inTok * p.input + outTok * p.output) / 1_000_000;
}

export const GET = withApi({ scope: "admin" }, async (req, { api }) => {
  const url = new URL(req.url);
  const days = Math.max(7, Math.min(90, Number(url.searchParams.get("days") ?? 30)));
  const since = new Date(Date.now() - days * 86400_000);

  // Todos los clientes del workspace (sin select — settings no está
  // en el SelectScalar generado de Prisma).
  const clients = await prisma.client.findMany({
    where: { workspaceId: api.workspaceId, deletedAt: null } as any
  });

  const taskIds = await prisma.task.findMany({
    where: { workspaceId: api.workspaceId, clientId: { in: clients.map((c) => c.id) } },
    select: { id: true, clientId: true }
  });
  const runs = await prisma.aiAgentRun.findMany({
    where: {
      workspaceId: api.workspaceId,
      createdAt: { gte: since },
      taskId: { in: taskIds.map((t) => t.id) }
    },
    select: {
      taskId: true,
      status: true,
      model: true,
      inputTokens: true,
      outputTokens: true
    }
  });

  // Map taskId → clientId
  const clientByTask = new Map(taskIds.map((t) => [t.id, t.clientId!]));

  // Agrupa runs por cliente
  type Stats = {
    total: number;
    succeeded: number;
    requiresHuman: number;
    failed: number;
    closed: number;
    cost: number;
  };
  const statsByClient = new Map<string, Stats>();
  for (const c of clients) {
    statsByClient.set(c.id, {
      total: 0,
      succeeded: 0,
      requiresHuman: 0,
      failed: 0,
      closed: 0,
      cost: 0
    });
  }
  for (const r of runs) {
    const cid = clientByTask.get(r.taskId);
    if (!cid) continue;
    const s = statsByClient.get(cid)!;
    s.total++;
    s.cost += costUsd(r.model, r.inputTokens ?? 0, r.outputTokens ?? 0);
    if (r.status === "SUCCEEDED") {
      s.succeeded++;
      s.closed++;
    }
    if (r.status === "REQUIRES_HUMAN") {
      s.requiresHuman++;
      s.closed++;
    }
    if (r.status === "FAILED") {
      s.failed++;
      s.closed++;
    }
  }

  function scoreFor(s: Stats): number {
    if (s.total === 0) return 0;
    const successRate = s.closed > 0 ? s.succeeded / s.closed : 0;
    const avgCost = s.cost / s.total;
    const humanRate = s.total > 0 ? s.requiresHuman / s.total : 0;

    const successPts = 40 * successRate;
    const costPts =
      avgCost <= 0.05 ? 25 : avgCost >= 0.5 ? 0 : 25 * (1 - (avgCost - 0.05) / 0.45);
    const interventionPts =
      humanRate <= 0 ? 20 : humanRate >= 0.5 ? 0 : 20 * (1 - humanRate / 0.5);
    const volumePts = Math.min(15, (s.total / 20) * 15);

    return Math.round(successPts + costPts + interventionPts + volumePts);
  }

  const result = clients
    .map((c) => {
      const s = statsByClient.get(c.id)!;
      const score = scoreFor(s);
      const autonomous = !!(c as any).settings?.aiAgent?.autonomous;
      return {
        clientId: c.id,
        clientName: c.name,
        autonomous,
        score,
        level:
          score >= 80
            ? ("ready" as const)
            : score >= 50
              ? ("supervised" as const)
              : ("manual" as const),
        stats: {
          total: s.total,
          succeeded: s.succeeded,
          requiresHuman: s.requiresHuman,
          failed: s.failed,
          successRate:
            s.closed > 0 ? Math.round((s.succeeded / s.closed) * 100) / 100 : null,
          totalCostUsd: Math.round(s.cost * 1000) / 1000,
          avgCostUsd: s.total > 0 ? Math.round((s.cost / s.total) * 1000) / 1000 : 0,
          humanRate:
            s.total > 0 ? Math.round((s.requiresHuman / s.total) * 100) / 100 : 0
        }
      };
    })
    .sort((a, b) => b.score - a.score);

  return NextResponse.json({ days, since: since.toISOString(), clients: result });
});

// Toggle autonomous flag
export const PUT = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const clientId = String(body?.clientId ?? "").trim();
  const autonomous = !!body?.autonomous;
  if (!clientId) return NextResponse.json({ error: "clientId requerido" }, { status: 400 });
  const c = await prisma.client.findFirst({
    where: { id: clientId, workspaceId: api.workspaceId }
  });
  if (!c) return NextResponse.json({ error: "cliente no encontrado" }, { status: 404 });
  const settings: any = (c as any).settings ?? {};
  if (!settings.aiAgent) settings.aiAgent = {};
  settings.aiAgent.autonomous = autonomous;
  await prisma.client.update({
    where: { id: clientId },
    data: { settings } as any
  });
  return NextResponse.json({ ok: true, clientId, autonomous });
});
