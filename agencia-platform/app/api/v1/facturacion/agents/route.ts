/**
 * Agentes bancarios — listar (GET) y enrolar (POST). Solo ADMIN + CSRF.
 * El token de enrolamiento se devuelve UNA sola vez (en BD solo su hash).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/auth";
import { assertSameOrigin } from "@/lib/api/csrf";
import { listAgents, enrollAgent } from "@/lib/facturacion/sepa/agent";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api);
  return NextResponse.json({ items: await listAgents(api.workspaceId) });
});

const schema = z.object({ name: z.string().min(1).max(80) });

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  assertSameOrigin(req);
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", "Falta el nombre del agente");
  const { agentId, token } = await enrollAgent(api.workspaceId, parsed.data.name, api.userId);
  // token: mostrarlo AHORA; no se vuelve a poder recuperar.
  return NextResponse.json({ ok: true, agentId, token });
});
