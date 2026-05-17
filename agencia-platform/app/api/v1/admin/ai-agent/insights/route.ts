/**
 * GET /api/v1/admin/ai-agent/insights?days=7
 *
 * Métricas agregadas para que el admin vea cómo se comporta NV IA:
 *   - runs por status / trigger
 *   - tasa de aprobación de drafts (EXECUTED vs REJECTED)
 *   - tools más usadas (top 15)
 *   - coste estimado y tokens consumidos
 *   - tiempo medio por run
 *   - últimos FAILED con su error (debugging directo)
 *   - últimos REQUIRES_HUMAN (qué decidió la IA que no podía resolver)
 *
 * Window por defecto: últimos 7 días. Param ?days=1..90.
 *
 * Sólo admin.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

// Precios aproximados (USD/1M tokens) para claude-opus-4-7
const PRICE_INPUT_PER_1M = 5.0;
const PRICE_OUTPUT_PER_1M = 25.0;

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");

  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 7, 1), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Runs del workspace en ventana — los pulsos básicos
  const runs = await prisma.aiAgentRun.findMany({
    where: {
      workspaceId: api.workspaceId,
      createdAt: { gte: since }
    },
    select: {
      id: true,
      status: true,
      trigger: true,
      stepsCount: true,
      inputTokens: true,
      outputTokens: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
      error: true,
      log: true,
      taskId: true,
      summary: true
    },
    orderBy: { createdAt: "desc" }
  });

  // Agregados por status y trigger
  const byStatus: Record<string, number> = {};
  const byTrigger: Record<string, number> = {};
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalDurationSec = 0;
  let durationCount = 0;
  const toolUsage: Record<string, number> = {};

  for (const r of runs) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byTrigger[r.trigger] = (byTrigger[r.trigger] ?? 0) + 1;
    totalInputTokens += r.inputTokens;
    totalOutputTokens += r.outputTokens;
    if (r.startedAt && r.finishedAt) {
      totalDurationSec += (r.finishedAt.getTime() - r.startedAt.getTime()) / 1000;
      durationCount++;
    }
    // tool usage: contar entradas type=tool_use en log
    if (Array.isArray(r.log)) {
      for (const step of r.log as any[]) {
        if (step?.type === "tool_use" && typeof step.tool === "string") {
          // El prefijo [subagent:role] queda fuera del conteo de tool puro
          const name = step.tool.replace(/^\[subagent:[^\]]+\]\s*/, "");
          toolUsage[name] = (toolUsage[name] ?? 0) + 1;
        }
      }
    }
  }

  // Drafts: aprobación / rechazo / pending
  const drafts = await prisma.aiDraft.findMany({
    where: {
      workspaceId: api.workspaceId,
      createdAt: { gte: since }
    },
    select: { status: true, kind: true }
  });
  const draftsByStatus: Record<string, number> = {};
  const draftsByKind: Record<string, number> = {};
  for (const d of drafts) {
    draftsByStatus[d.status] = (draftsByStatus[d.status] ?? 0) + 1;
    draftsByKind[d.kind] = (draftsByKind[d.kind] ?? 0) + 1;
  }
  const approvalRate =
    drafts.length === 0
      ? null
      : (draftsByStatus["EXECUTED"] ?? 0) /
        Math.max(1, (draftsByStatus["EXECUTED"] ?? 0) + (draftsByStatus["REJECTED"] ?? 0));

  // Top 15 tools más usadas
  const topTools = Object.entries(toolUsage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));

  // Últimos 5 FAILED — debugging directo desde insights
  const recentFailed = runs
    .filter((r) => r.status === "FAILED")
    .slice(0, 5)
    .map((r) => ({
      id: r.id,
      taskId: r.taskId,
      trigger: r.trigger,
      error: r.error?.slice(0, 240) ?? null,
      createdAt: r.createdAt
    }));

  // Últimos 5 REQUIRES_HUMAN
  const recentRequiresHuman = runs
    .filter((r) => r.status === "REQUIRES_HUMAN")
    .slice(0, 5)
    .map((r) => ({
      id: r.id,
      taskId: r.taskId,
      trigger: r.trigger,
      summary: r.summary?.slice(0, 240) ?? r.error?.slice(0, 240) ?? null,
      createdAt: r.createdAt
    }));

  // Coste estimado (USD)
  const estimatedCostUsd =
    (totalInputTokens / 1_000_000) * PRICE_INPUT_PER_1M +
    (totalOutputTokens / 1_000_000) * PRICE_OUTPUT_PER_1M;

  return NextResponse.json({
    windowDays: days,
    since: since.toISOString(),
    totals: {
      runs: runs.length,
      drafts: drafts.length,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      estimatedCostUsd: Math.round(estimatedCostUsd * 100) / 100,
      avgRunDurationSec: durationCount > 0 ? Math.round(totalDurationSec / durationCount) : null
    },
    runs: {
      byStatus,
      byTrigger
    },
    drafts: {
      byStatus: draftsByStatus,
      byKind: draftsByKind,
      approvalRate: approvalRate === null ? null : Math.round(approvalRate * 1000) / 10 // %
    },
    topTools,
    recentFailed,
    recentRequiresHuman
  });
});
