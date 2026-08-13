/**
 * GET /api/v1/ai/providers — SALUD/COSTE/BREAKER del multimodelo (admin, tenant-scoped).
 *
 * Muestra, por slot de modelo: proveedor, modelo, capacidades, coste por 1k tokens, si la
 * clave está configurada (health SIN red: hay env key → available), y el estado del circuit
 * breaker DURABLE para ese (workspace, proveedor). Además el modo del motor (live/shadow).
 * Solo lectura, sin secretos (nunca devuelve la clave, solo si existe). Kill-switch: flag
 * off → 404.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { orchestratorEnabled, orchestratorMode, multiModelEnabled } from "@/lib/ai/orchestrator/flags";
import { MODEL_SLOTS, slotHealth } from "@/lib/ai/orchestrator/providers";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*", rate: "admin", admin: true }, async (_req, { api }) => {
  if (!orchestratorEnabled()) {
    return NextResponse.json({ error: { code: "disabled", message: "Orquestador desactivado" } }, { status: 404 });
  }
  await requireAdmin(api);

  // Estado del breaker por proveedor (tenant-scoped). Puede no existir fila (breaker sano).
  const breakerRows = await prisma.aiProviderBreaker.findMany({
    where: { workspaceId: api.workspaceId },
    select: { provider: true, state: true, failureCount: true, openedAt: true, lastFailureAt: true, probeOwner: true, probeExpiresAt: true }
  });
  const byProvider = new Map(breakerRows.map((r: any) => [r.provider, r]));
  const now = Date.now();

  const live = multiModelEnabled() && orchestratorMode() === "live";
  const providers = MODEL_SLOTS.map((slot) => {
    const b: any = byProvider.get(slot.provider);
    const probeLive = !!(b?.probeOwner && b?.probeExpiresAt && new Date(b.probeExpiresAt).getTime() > now);
    return {
      id: slot.id,
      provider: slot.provider,
      model: slot.model,
      capabilities: slot.capabilities,
      costPer1kUsd: slot.costPer1kUsd ?? null,
      healthy: slotHealth(slot) === "available", // hay clave en el env → disponible
      breaker: b
        ? { state: b.state, failureCount: b.failureCount, openedAt: b.openedAt, lastFailureAt: b.lastFailureAt, probeLive }
        : { state: "closed", failureCount: 0, openedAt: null, lastFailureAt: null, probeLive: false }
    };
  });

  return NextResponse.json({
    engine: { live, mode: orchestratorMode(), multiModel: multiModelEnabled() },
    providers
  });
});
