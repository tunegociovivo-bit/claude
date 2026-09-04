import { prisma } from "@/lib/db/prisma";
import { processRunInBackground } from "@/lib/ai/nv-ia/process-run";

const RECOVERABLE_STATUSES = new Set(["FAILED", "REQUIRES_HUMAN"]);

const ANTHROPIC_BILLING_ERRORS = [
  "credit balance is too low",
  "plans & billing",
  "purchase credits"
];

export function isRecoverableAnthropicBillingFailure(run: {
  status: string;
  error: string | null;
}): boolean {
  if (!RECOVERABLE_STATUSES.has(run.status) || !run.error) return false;

  const normalizedError = run.error.toLowerCase();
  return ANTHROPIC_BILLING_ERRORS.some((message) => normalizedError.includes(message));
}

export async function recoverRecentAnthropicBillingFailures(options?: {
  hours?: number;
  limit?: number;
}): Promise<number> {
  const hours = options?.hours ?? 24;
  const limit = options?.limit ?? 20;
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const failedCandidates = await prisma.aiAgentRun.findMany({
    where: {
      status: { in: ["FAILED", "REQUIRES_HUMAN"] },
      createdAt: { gte: cutoff },
      error: { not: null }
    },
    orderBy: { createdAt: "desc" },
    take: limit
  });

  let recovered = 0;
  for (const failedRun of failedCandidates) {
    if (!isRecoverableAnthropicBillingFailure(failedRun)) continue;

    const newerRun = await prisma.aiAgentRun.findFirst({
      where: {
        taskId: failedRun.taskId,
        createdAt: { gt: failedRun.createdAt }
      },
      select: { id: true }
    });
    if (newerRun) continue;

    const retry = await prisma.aiAgentRun.create({
      data: {
        workspaceId: failedRun.workspaceId,
        taskId: failedRun.taskId,
        requesterId: failedRun.requesterId,
        trigger: failedRun.trigger,
        triggerContext:
          "Recuperación automática tras rechazo de Anthropic por saldo. Completa la petición original usando el proveedor alternativo OpenAI."
      }
    });
    processRunInBackground(retry.id);
    recovered += 1;
  }

  return recovered;
}
