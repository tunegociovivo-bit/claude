import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/facturacion/sepa/agent";
import { ensureReconciliationConfig } from "@/lib/facturacion/reconciliation/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const agent = await authenticateAgent(req.headers.get("authorization") ?? "");
  if (!agent) return NextResponse.json({ error: { code: "unauthorized", message: "Agente no autorizado" } }, { status: 401 });
  const config = await ensureReconciliationConfig(agent.workspaceId);
  return NextResponse.json({
    enabled: config.enabled,
    startsAt: config.startsAt.toISOString(),
    pollMinutes: config.pollMinutes,
    provider: config.provider,
    profile: config.profile
  });
}
