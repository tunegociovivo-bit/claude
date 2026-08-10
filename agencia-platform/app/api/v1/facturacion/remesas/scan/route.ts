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
import { madridBusinessDayWindow } from "@/lib/facturacion/sepa/recency";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  assertSameOrigin(req);
  // Solo facturas EMITIDAS hoy en Madrid. `createdAt` no sirve: una factura
  // histórica puede haberse importado al HUB hace segundos.
  const window = madridBusinessDayWindow();
  const res = await createRequestsForCandidates(api.workspaceId, api.userId, {
    max: 100,
    issuedAfter: window.start,
    issuedBefore: window.end
  });
  return NextResponse.json({ ok: true, ...res });
});
