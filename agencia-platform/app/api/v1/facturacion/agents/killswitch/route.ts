/**
 * Kill switch del agente (habilitar/pausar que reclame trabajos). Solo ADMIN + CSRF.
 * OFF por defecto: con el switch apagado, ningún agente reclama trabajos.
 *  GET → { enabled }   PATCH { enabled } → { ok, enabled }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/auth";
import { assertSameOrigin } from "@/lib/api/csrf";
import { isAgentClaimingEnabled, setAgentClaimingEnabled } from "@/lib/facturacion/sepa/agent";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api);
  return NextResponse.json({ enabled: await isAgentClaimingEnabled(api.workspaceId) });
});

const schema = z.object({ enabled: z.boolean() });

export const PATCH = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  assertSameOrigin(req);
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", "Falta enabled");
  await setAgentClaimingEnabled(api.workspaceId, parsed.data.enabled);
  return NextResponse.json({ ok: true, enabled: parsed.data.enabled });
});
