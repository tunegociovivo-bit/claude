/**
 * GET /api/v1/ai/learning — telemetría del APRENDIZAJE (admin, flag-gated).
 * Muestra qué estrategias aprendió el motor por (firma de tarea, causa raíz): éxitos/
 * fallos, score de prioridad, y la última evidencia del verificador (ya redactada). Solo
 * del workspace del solicitante (tenant-scoped). La firma es un hash (sin texto crudo/PII).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { orchestratorEnabled } from "@/lib/ai/orchestrator/flags";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*", rate: "admin", admin: true }, async (req, { api }) => {
  if (!orchestratorEnabled()) {
    return NextResponse.json({ error: { code: "disabled", message: "Orquestador desactivado" } }, { status: 404 });
  }
  await requireAdmin(api);

  const url = new URL(req.url);
  const sig = url.searchParams.get("taskSignature");
  const take = Math.min(Math.max(1, Number(url.searchParams.get("limit")) || 100), 500);

  const rows = await prisma.aiStrategyMemory.findMany({
    where: { workspaceId: api.workspaceId, ...(sig ? { taskSignature: sig } : {}) },
    orderBy: [{ score: "desc" }, { lastUsedAt: "desc" }],
    take,
    select: {
      taskSignature: true,
      rootCause: true,
      strategyKind: true,
      provider: true,
      model: true,
      successCount: true,
      failureCount: true,
      score: true,
      lastOutcome: true,
      lastEvidence: true, // ya redactada al guardar
      lastUsedAt: true
    }
  });

  const totalSuccess = rows.reduce((s, r) => s + r.successCount, 0);
  const totalFailure = rows.reduce((s, r) => s + r.failureCount, 0);
  return NextResponse.json({
    summary: { strategies: rows.length, verifiedSuccesses: totalSuccess, verifiedFailures: totalFailure },
    learned: rows
  });
});
