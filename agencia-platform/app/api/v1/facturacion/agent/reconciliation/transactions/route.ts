import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAgent } from "@/lib/facturacion/sepa/agent";
import { importAndReconcileMovements } from "@/lib/facturacion/reconciliation/service";
import { bankMovementInputSchema } from "@/lib/facturacion/reconciliation/input";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const agent = await authenticateAgent(req.headers.get("authorization") ?? "");
  if (!agent) return NextResponse.json({ error: { code: "unauthorized", message: "Agente no autorizado" } }, { status: 401 });
  const parsed = z.object({ movements: z.array(bankMovementInputSchema).max(500) }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation_error", message: "Movimientos no válidos" } }, { status: 400 });
  return NextResponse.json({ ok: true, ...(await importAndReconcileMovements(agent.workspaceId, parsed.data.movements)) });
}
