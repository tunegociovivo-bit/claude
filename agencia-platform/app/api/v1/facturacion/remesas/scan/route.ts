/**
 * Remesas SEPA — detectar candidatas y crear solicitudes (idempotente) + email.
 * Solo ADMIN. Protegido CSRF + rate admin. NO firma ni cobra nada.
 *  POST → { created, skipped, scanned }
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { assertSameOrigin } from "@/lib/api/csrf";
import { createRequestsForCandidates } from "@/lib/facturacion/sepa/remittance";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  assertSameOrigin(req);
  const res = await createRequestsForCandidates(api.workspaceId, api.userId, { max: 100 });
  return NextResponse.json({ ok: true, ...res });
});
