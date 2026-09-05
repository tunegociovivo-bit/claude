import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/facturacion/sepa/agent";
import { getRecentSepaDiagnostics, recoverRecentSepaApprovals } from "@/lib/facturacion/sepa/diagnostics";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const agent = await authenticateAgent(req.headers.get("authorization") ?? "");
  if (!agent) return NextResponse.json({ error: { code: "unauthorized", message: "Agente no autorizado" } }, { status: 401 });
  const items = await getRecentSepaDiagnostics(agent.workspaceId, 50);
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const agent = await authenticateAgent(req.headers.get("authorization") ?? "");
  if (!agent) return NextResponse.json({ error: { code: "unauthorized", message: "Agente no autorizado" } }, { status: 401 });
  const result = await recoverRecentSepaApprovals(agent.workspaceId);
  return NextResponse.json({ ok: true, ...result });
}
