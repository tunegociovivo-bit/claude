/**
 * Revocar un agente (su token deja de valer). Solo ADMIN + CSRF.
 *  POST → { ok }
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { assertSameOrigin } from "@/lib/api/csrf";
import { revokeAgent } from "@/lib/facturacion/sepa/agent";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { params, api }) => {
  await requireAdmin(api);
  assertSameOrigin(req);
  await revokeAgent(api.workspaceId, String(params.id));
  return NextResponse.json({ ok: true });
});
