import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAgent } from "@/lib/facturacion/sepa/agent";
import { recordReconciliationFailure } from "@/lib/facturacion/reconciliation/service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const agent = await authenticateAgent(req.headers.get("authorization") ?? "");
  if (!agent) return NextResponse.json({ error: { code: "unauthorized", message: "Agente no autorizado" } }, { status: 401 });
  const parsed = z.object({ reason: z.string().min(1).max(1000) }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation_error", message: "Error no válido" } }, { status: 400 });
  return NextResponse.json({ ok: true, ...(await recordReconciliationFailure(agent.workspaceId, parsed.data.reason)) });
}
