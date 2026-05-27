/**
 * GET /api/v1/admin/sonia-dashboard?days=7
 *
 * Devuelve métricas agregadas de los runs de Sonia para el dashboard:
 *   - totales: runs, success, requires_human, failed, tasa éxito
 *   - coste: input/output tokens, $ aproximado por modelo
 *   - top tools usadas (de los logs)
 *   - top clientes atendidos (de las tasks)
 *   - top errores (clasificados por tipo)
 *   - serie diaria de runs + coste (para gráfica)
 *
 * Sin schema migration: todo se calcula sobre la marcha agregando
 * AiAgentRun.{status, inputTokens, outputTokens, log, createdAt}.
 *
 * Pricing aproximado Opus 4.7 (mayo 2026):
 *   - $15 / M input tokens
 *   - $75 / M output tokens
 * Cacheamos en memoria 60s para no recalcular en cada poll.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

// Precios USD por 1M tokens. Actualizar cuando Anthropic ajuste.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-7": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 0.8, output: 4 }
};
const DEFAULT_PRICE = PRICING["claude-opus-4-7"];

function priceFor(model: string | null | undefined) {
  if (!model) return DEFAULT_PRICE;
  return PRICING[model] ?? DEFAULT_PRICE;
}

function costUsd(model: string | null, inTok: number, outTok: number): number {
  const p = priceFor(model);
  return (inTok * p.input + outTok * p.output) / 1_000_000;
}

export const GET = withApi({ scope: "admin" }, async (req, { api }) => {
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days") ?? 7)));
  const since = new Date(Date.now() - days * 86400_000);

  const runs = await prisma.aiAgentRun.findMany({
    where: { workspaceId: api.workspaceId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      taskId: true,
      status: true,
      model: true,
      inputTokens: true,
      outputTokens: true,
      stepsCount: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
      error: true,
      log: true
    }
  });

  // Tasks lookup para nombres de cliente
  const taskIds = Array.from(new Set(runs.map((r) => r.taskId)));
  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds }, workspaceId: api.workspaceId },
    select: { id: true, title: true, clientId: true, client: { select: { name: true } } }
  });
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // Totales
  const totals = {
    total: runs.length,
    succeeded: runs.filter((r) => r.status === "SUCCEEDED").length,
    requiresHuman: runs.filter((r) => r.status === "REQUIRES_HUMAN").length,
    failed: runs.filter((r) => r.status === "FAILED").length,
    running: runs.filter((r) => r.status === "RUNNING").length,
    pending: runs.filter((r) => r.status === "PENDING").length
  };
  const closed = totals.succeeded + totals.requiresHuman + totals.failed;
  const successRate = closed > 0 ? totals.succeeded / closed : 0;

  // Coste agregado
  let totalIn = 0;
  let totalOut = 0;
  let totalCost = 0;
  for (const r of runs) {
    totalIn += r.inputTokens ?? 0;
    totalOut += r.outputTokens ?? 0;
    totalCost += costUsd(r.model, r.inputTokens ?? 0, r.outputTokens ?? 0);
  }
  const avgCost = totals.total > 0 ? totalCost / totals.total : 0;

  // Top tools (de los logs — cada step de tipo "tool_use" tiene name)
  const toolCounter: Record<string, number> = {};
  for (const r of runs) {
    const log = Array.isArray(r.log) ? (r.log as any[]) : [];
    for (const step of log) {
      if (step?.type === "tool_use" && typeof step.name === "string") {
        toolCounter[step.name] = (toolCounter[step.name] ?? 0) + 1;
      }
    }
  }
  const topTools = Object.entries(toolCounter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));

  // Top clientes
  const clientCounter: Record<string, { name: string; count: number; cost: number }> = {};
  for (const r of runs) {
    const t = taskById.get(r.taskId);
    const key = t?.clientId ?? "_sin_cliente";
    const name = t?.client?.name ?? "Sin cliente";
    if (!clientCounter[key]) clientCounter[key] = { name, count: 0, cost: 0 };
    clientCounter[key].count++;
    clientCounter[key].cost += costUsd(r.model, r.inputTokens ?? 0, r.outputTokens ?? 0);
  }
  const topClients = Object.entries(clientCounter)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([id, info]) => ({ id, ...info }));

  // Top errores (por categoría — extraemos prefijo común)
  const errorCounter: Record<string, number> = {};
  for (const r of runs) {
    if (!r.error) continue;
    // Categoría = primeras 50 chars del error después de normalizar IDs/tokens
    const cat = r.error
      .replace(/[a-f0-9]{20,}/gi, "<id>")
      .replace(/\d{6,}/g, "<num>")
      .slice(0, 80)
      .trim();
    errorCounter[cat] = (errorCounter[cat] ?? 0) + 1;
  }
  const topErrors = Object.entries(errorCounter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([msg, count]) => ({ msg, count }));

  // Serie diaria
  const dailyMap: Record<string, { runs: number; cost: number; succeeded: number }> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400_000);
    const key = d.toISOString().slice(0, 10);
    dailyMap[key] = { runs: 0, cost: 0, succeeded: 0 };
  }
  for (const r of runs) {
    const key = r.createdAt.toISOString().slice(0, 10);
    if (!dailyMap[key]) dailyMap[key] = { runs: 0, cost: 0, succeeded: 0 };
    dailyMap[key].runs++;
    if (r.status === "SUCCEEDED") dailyMap[key].succeeded++;
    dailyMap[key].cost += costUsd(r.model, r.inputTokens ?? 0, r.outputTokens ?? 0);
  }
  const daily = Object.entries(dailyMap)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({ date, ...v, cost: Math.round(v.cost * 1000) / 1000 }));

  // Runs recientes para tabla (últimos 20)
  const recent = runs.slice(0, 20).map((r) => {
    const t = taskById.get(r.taskId);
    return {
      runId: r.id,
      taskId: r.taskId,
      taskTitle: t?.title ?? "(task eliminada)",
      clientName: t?.client?.name ?? null,
      status: r.status,
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cost: Math.round(costUsd(r.model, r.inputTokens ?? 0, r.outputTokens ?? 0) * 1000) / 1000,
      steps: r.stepsCount,
      durationSec:
        r.startedAt && r.finishedAt
          ? Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000)
          : null,
      createdAt: r.createdAt.toISOString()
    };
  });

  return NextResponse.json({
    days,
    since: since.toISOString(),
    totals,
    successRate,
    cost: {
      totalUsd: Math.round(totalCost * 1000) / 1000,
      avgPerRunUsd: Math.round(avgCost * 1000) / 1000,
      totalInputTokens: totalIn,
      totalOutputTokens: totalOut
    },
    topTools,
    topClients,
    topErrors,
    daily,
    recent
  });
});
