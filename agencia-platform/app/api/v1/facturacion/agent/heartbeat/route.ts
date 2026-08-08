/**
 * Agente bancario — heartbeat. Bearer token de agente (hash en BD). Sin sesión.
 *  POST { version?, platform? } → { ok, online }
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent, agentHeartbeat } from "@/lib/facturacion/sepa/agent";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const agent = await authenticateAgent(req.headers.get("authorization") ?? "");
  if (!agent) return NextResponse.json({ error: { code: "unauthorized", message: "Agente no autorizado" } }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  await agentHeartbeat(agent.id, { version: typeof body?.version === "string" ? body.version.slice(0, 40) : undefined, platform: typeof body?.platform === "string" ? body.platform.slice(0, 40) : undefined });
  return NextResponse.json({ ok: true });
}
