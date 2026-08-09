/**
 * Agente bancario — cerrar trabajo. PREPARED_PENDING_SIGNATURE exige
 * verifiedPendingSignature=true (verificación visible del estado pendiente de
 * firma). NUNCA implica firma ni cobro. También FAILED.
 *  POST { result: "PREPARED_PENDING_SIGNATURE", verifiedPendingSignature: true, resultRef? }
 *     | { result: "FAILED", error? }
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent, completeJob, type CompleteInput } from "@/lib/facturacion/sepa/agent";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const agent = await authenticateAgent(req.headers.get("authorization") ?? "");
  if (!agent) return NextResponse.json({ error: { code: "unauthorized", message: "Agente no autorizado" } }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  let input: CompleteInput;
  if (body?.result === "PREPARED_PENDING_SIGNATURE") {
    if (body?.verifiedPendingSignature !== true) {
      return NextResponse.json({ error: { code: "not_verified", message: "Falta verifiedPendingSignature=true" } }, { status: 400 });
    }
    input = { result: "PREPARED_PENDING_SIGNATURE", verifiedPendingSignature: true, resultRef: typeof body?.resultRef === "string" ? body.resultRef : undefined };
  } else if (body?.result === "FAILED") {
    input = { result: "FAILED", error: typeof body?.error === "string" ? body.error : undefined };
  } else {
    return NextResponse.json({ error: { code: "bad_result", message: "result inválido" } }, { status: 400 });
  }
  try {
    const r = await completeJob(agent.id, agent.workspaceId, params.id, input);
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: { code: "complete_failed", message: String(e?.message ?? e) } }, { status: 409 });
  }
}
