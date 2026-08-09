/**
 * Remesas SEPA — datos de la solicitud por TOKEN (para la página de aprobación).
 * Requiere usuario autenticado y ADMIN. NO cambia estado. Búsqueda por hash.
 *  GET → { ok, request } | { ok:false, reason }
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { getRequestByToken } from "@/lib/facturacion/sepa/remittance";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await requireAdmin(api);
  const token = String(params.token ?? "");
  const res = await getRequestByToken(api.workspaceId, token);
  if (!res.ok) return NextResponse.json({ ok: false, reason: res.reason }, { status: 404 });
  const r = res.request;
  // Devolvemos solo lo necesario para el resumen (nunca el hash ni datos bancarios).
  return NextResponse.json({
    ok: true,
    request: {
      id: r.id,
      status: r.status,
      companyName: r.companyName,
      clientName: r.clientName,
      invoiceNumber: r.invoiceNumber,
      amountCents: r.amountCents,
      currency: r.currency,
      mandateRef: r.mandateRef,
      ibanMasked: r.ibanMasked,
      providerStatus: r.providerStatus,
      tokenExpiresAt: r.tokenExpiresAt
    }
  });
});
