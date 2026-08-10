import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAgent } from "@/lib/facturacion/sepa/agent";
import { importAndReconcileMovements } from "@/lib/facturacion/reconciliation/service";

export const dynamic = "force-dynamic";

const movement = z.object({
  externalId: z.string().min(1).max(200),
  bookedAt: z.string().datetime(),
  valueAt: z.string().datetime().nullable().optional(),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3).optional(),
  counterpartyName: z.string().max(200).nullable().optional(),
  reference: z.string().max(500).nullable().optional(),
  accountMasked: z.string().max(40).nullable().optional()
});

export async function POST(req: NextRequest) {
  const agent = await authenticateAgent(req.headers.get("authorization") ?? "");
  if (!agent) return NextResponse.json({ error: { code: "unauthorized", message: "Agente no autorizado" } }, { status: 401 });
  const parsed = z.object({ movements: z.array(movement).max(500) }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation_error", message: "Movimientos no válidos" } }, { status: 400 });
  return NextResponse.json({ ok: true, ...(await importAndReconcileMovements(agent.workspaceId, parsed.data.movements)) });
}
