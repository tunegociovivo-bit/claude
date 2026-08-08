/**
 * Agente bancario — reclamar el siguiente trabajo (claim atómico con lease).
 * Devuelve SOLO datos autorizados (sin secretos). null si no hay o si el
 * claiming está apagado (kill switch / OFF por defecto).
 *  POST → { job } | { job: null }
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent, claimNextJob } from "@/lib/facturacion/sepa/agent";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const agent = await authenticateAgent(req.headers.get("authorization") ?? "");
  if (!agent) return NextResponse.json({ error: { code: "unauthorized", message: "Agente no autorizado" } }, { status: 401 });
  const job = await claimNextJob(agent.id, agent.workspaceId);
  return NextResponse.json({ job });
}
