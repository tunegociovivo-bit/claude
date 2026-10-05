import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api/auth";

/**
 * Tope mensual de gasto de IA de los módulos de contenidos por negocio. Las
 * claves de IA son de Negocio Vivo, así que un uso desbocado lo paga la agencia.
 * Orden: Workspace.settings.contentAiMonthlyLimitUsd (lo fija el operador) →
 * CONTENT_AI_MONTHLY_LIMIT_USD → 60 USD. 0 = sin límite.
 */
const DEFAULT_LIMIT_USD = 60;

export function monthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function parseLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function readAiLimitUsd(settings: unknown): number {
  return (
    parseLimit((settings as any)?.contentAiMonthlyLimitUsd) ??
    parseLimit(process.env.CONTENT_AI_MONTHLY_LIMIT_USD) ??
    DEFAULT_LIMIT_USD
  );
}

export async function getAiBudget(workspaceId: string): Promise<{ limitUsd: number; spentUsd: number; exceeded: boolean }> {
  const [ws, agg] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } }),
    prisma.aiUsage.aggregate({ where: { workspaceId, createdAt: { gte: monthStartUtc() } }, _sum: { costMicros: true } }),
  ]);
  const limitUsd = readAiLimitUsd(ws?.settings);
  const spentUsd = (agg._sum.costMicros ?? 0) / 1_000_000;
  return { limitUsd, spentUsd, exceeded: limitUsd > 0 && spentUsd >= limitUsd };
}

export const AI_BUDGET_MESSAGE =
  "Has llegado al límite mensual de IA de tu cuenta. Se renueva el día 1; si necesitas más, avisa a Negocio Vivo.";

export async function assertAiBudget(workspaceId: string): Promise<void> {
  const b = await getAiBudget(workspaceId);
  if (b.exceeded) {
    throw new ApiError(429, "ai_budget_exceeded", AI_BUDGET_MESSAGE);
  }
}
