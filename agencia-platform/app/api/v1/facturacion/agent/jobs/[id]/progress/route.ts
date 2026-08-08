/**
 * Agente bancario — reportar progreso: RUNNING (renueva lease) o NEEDS_USER (pausa).
 *  POST { state: "RUNNING"|"NEEDS_USER", progress?, reason? }
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent, reportProgress } from "@/lib/facturacion/sepa/agent";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const agent = await authenticateAgent(req.headers.get("authorization") ?? "");
  if (!agent) return NextResponse.json({ error: { code: "unauthorized", message: "Agente no autorizado" } }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const state = body?.state === "NEEDS_USER" ? "NEEDS_USER" : body?.state === "RUNNING" ? "RUNNING" : null;
  if (!state) return NextResponse.json({ error: { code: "bad_state", message: "state inválido" } }, { status: 400 });
  try {
    const r = await reportProgress(agent.id, agent.workspaceId, params.id, { state, progress: body?.progress, reason: body?.reason });
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: { code: "progress_failed", message: String(e?.message ?? e) } }, { status: 409 });
  }
}
