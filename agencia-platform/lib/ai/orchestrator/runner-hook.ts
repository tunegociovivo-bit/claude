/**
 * Hook de SHADOW para el runner (Slice 2c). Cuando `HUB_AUTONOMY_SHADOW=on`,
 * registra qué decidiría `resolveAutonomy` para una tool-call (nivel A0–A4,
 * riesgo, si requiere aprobación, si una aprobación viva la cubriría), SIN
 * ejecutar nada externo y SIN cambiar el comportamiento del runner.
 *
 * Invariantes: nunca lanza (se traga cualquier error), nunca bloquea (fire-and-
 * forget), y no hace nada cuando el flag está off (coste cero).
 */
import { autonomyShadowEnabled } from "./flags";
import { shadowEvaluate } from "./autonomy-shadow";
import { liveApprovals } from "./store";
import { mergeAutonomyPolicy } from "@/lib/ai/autonomy/policy";

type PrismaLike = any;

export function maybeRecordAutonomyShadow(
  prisma: PrismaLike,
  args: { workspaceId: string; isAdmin?: boolean; action: string; input?: unknown; amountCents?: number; volume?: number; clientId?: string | null; policy?: any }
): void {
  if (!autonomyShadowEnabled()) return; // off por defecto → coste cero
  void (async () => {
    try {
      const now = new Date();
      const approvals = await liveApprovals(prisma, args.workspaceId, now);
      const policy = mergeAutonomyPolicy(args.policy ?? null);
      const rec = shadowEvaluate(
        { action: args.action, input: args.input, amountCents: args.amountCents, volume: args.volume, clientId: args.clientId ?? null },
        { workspaceId: args.workspaceId, isAdmin: !!args.isAdmin },
        approvals,
        now,
        policy
      );
      // Solo metadatos de decisión (sin PII/entradas crudas).
      console.log(
        `[autonomy-shadow] ${JSON.stringify({
          action: rec.action,
          level: rec.grantedLevel,
          risk: rec.effectiveRisk,
          external: rec.external,
          requiresApproval: rec.requiresApproval,
          approvalUsed: rec.approvalUsed,
          allowed: rec.allowed,
          executed: rec.executed // siempre false
        })}`
      );
    } catch (e: any) {
      // Shadow: jamás rompe el runner, pero deja rastro para depurar.
      console.warn(`[autonomy-shadow] registro omitido: ${String(e?.message ?? e).slice(0, 120)}`);
    }
  })();
}
