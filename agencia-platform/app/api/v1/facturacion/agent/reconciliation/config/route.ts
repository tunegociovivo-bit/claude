import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/facturacion/sepa/agent";
import { ensureReconciliationConfig, requestReconciliation } from "@/lib/facturacion/reconciliation/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const agent = await authenticateAgent(req.headers.get("authorization") ?? "");
  if (!agent) return NextResponse.json({ error: { code: "unauthorized", message: "Agente no autorizado" } }, { status: 401 });
  const config = await ensureReconciliationConfig(agent.workspaceId);
  const retryState = ((config.profile as Record<string, unknown> | null)?.retryState ?? null) as { attempts?: number; lastFailureAt?: string } | null;
  return NextResponse.json({
    enabled: config.enabled,
    startsAt: config.startsAt.toISOString(),
    dailyAt: "08:00",
    timeZone: "Europe/Madrid",
    lastSyncAt: config.lastSyncAt?.toISOString() ?? null,
    retryAttempts: Number(retryState?.attempts ?? 0),
    lastFailureAt: retryState?.lastFailureAt ?? null,
    provider: config.provider,
    profile: config.profile
  });
}

export async function POST(req: NextRequest) {
  const agent = await authenticateAgent(req.headers.get("authorization") ?? "");
  if (!agent) return NextResponse.json({ error: { code: "unauthorized", message: "Agente no autorizado" } }, { status: 401 });
  const config = await requestReconciliation(agent.workspaceId);
  return NextResponse.json({ ok: true, requested: true, lastSyncAt: config.lastSyncAt });
}
