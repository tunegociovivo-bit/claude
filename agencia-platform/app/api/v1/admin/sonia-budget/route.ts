/**
 * GET / PUT /api/v1/admin/sonia-budget
 *
 * Workspace.settings.aiAgent.monthlyBudgetUsd (tope mensual global).
 * PUT body: { budgetUsd: number | null } — null o 0 = sin tope.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "admin" }, async (_req, { api }) => {
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const budgetUsd = Number((ws?.settings as any)?.aiAgent?.monthlyBudgetUsd) || null;

  // Gastado este mes para mostrar en UI
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const runs = await prisma.aiAgentRun.findMany({
    where: { workspaceId: api.workspaceId, createdAt: { gte: monthStart } },
    select: { model: true, inputTokens: true, outputTokens: true }
  });
  const PRICING: Record<string, { input: number; output: number }> = {
    "claude-opus-4-7": { input: 15, output: 75 },
    "claude-sonnet-4-6": { input: 3, output: 15 },
    "claude-haiku-4-5": { input: 0.8, output: 4 }
  };
  const spent = runs.reduce((a, r) => {
    const p = PRICING[r.model ?? "claude-opus-4-7"];
    return a + ((r.inputTokens ?? 0) * p.input + (r.outputTokens ?? 0) * p.output) / 1_000_000;
  }, 0);

  return NextResponse.json({
    budgetUsd,
    spentUsd: Math.round(spent * 1000) / 1000,
    runsThisMonth: runs.length
  });
});

export const PUT = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const raw = body?.budgetUsd;
  const budgetUsd =
    raw === null || raw === "" || raw === 0 ? null : Number(raw);
  if (budgetUsd !== null && (!Number.isFinite(budgetUsd) || budgetUsd < 0)) {
    return NextResponse.json({ error: "budgetUsd inválido" }, { status: 400 });
  }
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const settings: any = ws?.settings ?? {};
  if (!settings.aiAgent) settings.aiAgent = {};
  if (budgetUsd === null) delete settings.aiAgent.monthlyBudgetUsd;
  else settings.aiAgent.monthlyBudgetUsd = budgetUsd;
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true, budgetUsd });
});
