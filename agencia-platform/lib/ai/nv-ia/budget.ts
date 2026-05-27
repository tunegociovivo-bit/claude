/**
 * Control de presupuesto por cliente y por workspace.
 *
 * Permite poner topes mensuales en $:
 *   - Workspace.settings.aiAgent.monthlyBudgetUsd → tope global
 *   - Client.settings.aiAgent.monthlyBudgetUsd → tope per-client
 *
 * Cuando un run está a punto de arrancar, se suma el coste real de
 * todos los runs del mes actual (calculado con pricing por modelo).
 * Si excede el tope:
 *   - 80% → warning (log + comentario informativo, sigue ejecutando)
 *   - 100% → bloqueo: la task pasa a REQUIRES_HUMAN con razón
 *     "budget agotado este mes" y notificación al admin.
 *
 * No es un guard "duro" en mitad de ejecución (eso requeriría parar
 * un run a mitad). Es un guard de entrada — la idea es que Sonia
 * sepa decir "este mes no puedo más, dime si autorizas presupuesto
 * extra" en lugar de seguir quemando tokens.
 */

import { prisma } from "@/lib/db/prisma";

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-7": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 0.8, output: 4 }
};

function costUsd(model: string | null, inTok: number, outTok: number): number {
  const p = PRICING[model ?? ""] ?? PRICING["claude-opus-4-7"];
  return (inTok * p.input + outTok * p.output) / 1_000_000;
}

export type BudgetCheck = {
  ok: boolean;
  reason: string;
  level: "ok" | "warning" | "blocked";
  /** Tope aplicable ($USD) o null si no hay */
  budgetUsd: number | null;
  spentUsd: number;
  scope: "workspace" | "client";
};

export async function checkBudgetBeforeRun(opts: {
  workspaceId: string;
  taskId: string;
}): Promise<BudgetCheck> {
  // Carga task para descubrir clientId
  const task = await prisma.task.findFirst({
    where: { id: opts.taskId, workspaceId: opts.workspaceId },
    select: { clientId: true }
  });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Tope client (si la task tiene cliente)
  if (task?.clientId) {
    const client = await prisma.client.findFirst({
      where: { id: task.clientId, workspaceId: opts.workspaceId }
    });
    const budgetUsd = Number((client as any)?.settings?.aiAgent?.monthlyBudgetUsd);
    if (Number.isFinite(budgetUsd) && budgetUsd > 0) {
      // Tasks de este cliente en el mes
      const clientTaskIds = await prisma.task.findMany({
        where: { clientId: task.clientId, workspaceId: opts.workspaceId },
        select: { id: true }
      });
      const ids = clientTaskIds.map((t) => t.id);
      const runs = await prisma.aiAgentRun.findMany({
        where: {
          workspaceId: opts.workspaceId,
          createdAt: { gte: monthStart },
          taskId: { in: ids }
        },
        select: { model: true, inputTokens: true, outputTokens: true }
      });
      const spent = runs.reduce(
        (a, r) => a + costUsd(r.model, r.inputTokens ?? 0, r.outputTokens ?? 0),
        0
      );
      if (spent >= budgetUsd) {
        return {
          ok: false,
          reason: `Presupuesto de Sonia para ${client?.name ?? "cliente"} agotado este mes ($${spent.toFixed(2)} / $${budgetUsd.toFixed(2)}).`,
          level: "blocked",
          budgetUsd,
          spentUsd: spent,
          scope: "client"
        };
      }
      if (spent >= budgetUsd * 0.8) {
        return {
          ok: true,
          reason: `Cliente ${client?.name} al 80%+ del presupuesto: $${spent.toFixed(2)} / $${budgetUsd.toFixed(2)}.`,
          level: "warning",
          budgetUsd,
          spentUsd: spent,
          scope: "client"
        };
      }
      return {
        ok: true,
        reason: "dentro de presupuesto del cliente",
        level: "ok",
        budgetUsd,
        spentUsd: spent,
        scope: "client"
      };
    }
  }

  // Tope workspace
  const ws = await prisma.workspace.findUnique({
    where: { id: opts.workspaceId },
    select: { settings: true }
  });
  const budgetUsd = Number((ws?.settings as any)?.aiAgent?.monthlyBudgetUsd);
  if (Number.isFinite(budgetUsd) && budgetUsd > 0) {
    const runs = await prisma.aiAgentRun.findMany({
      where: { workspaceId: opts.workspaceId, createdAt: { gte: monthStart } },
      select: { model: true, inputTokens: true, outputTokens: true }
    });
    const spent = runs.reduce(
      (a, r) => a + costUsd(r.model, r.inputTokens ?? 0, r.outputTokens ?? 0),
      0
    );
    if (spent >= budgetUsd) {
      return {
        ok: false,
        reason: `Presupuesto mensual del workspace agotado ($${spent.toFixed(2)} / $${budgetUsd.toFixed(2)}).`,
        level: "blocked",
        budgetUsd,
        spentUsd: spent,
        scope: "workspace"
      };
    }
    if (spent >= budgetUsd * 0.8) {
      return {
        ok: true,
        reason: `Workspace al 80%+ del presupuesto: $${spent.toFixed(2)} / $${budgetUsd.toFixed(2)}.`,
        level: "warning",
        budgetUsd,
        spentUsd: spent,
        scope: "workspace"
      };
    }
  }

  return {
    ok: true,
    reason: "sin tope configurado",
    level: "ok",
    budgetUsd: null,
    spentUsd: 0,
    scope: "workspace"
  };
}
