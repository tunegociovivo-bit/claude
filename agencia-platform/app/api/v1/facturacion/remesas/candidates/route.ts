/**
 * Remesas SEPA — facturas candidatas (paginado, sin traer las 300+ completas).
 * Solo ADMIN. Muestra elegibles y no-elegibles con el motivo.
 *  GET ?take=&skip=
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { findCandidateInvoices, getNegocioVivoIssuer } from "@/lib/facturacion/sepa/remittance";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api);
  const nv = await getNegocioVivoIssuer(api.workspaceId);
  if (!nv) return NextResponse.json({ issuerMissing: true, items: [] });
  const url = new URL(req.url);
  const take = Number(url.searchParams.get("take") ?? "100") || 100;
  const skip = Number(url.searchParams.get("skip") ?? "0") || 0;
  const items = await findCandidateInvoices(api.workspaceId, { take, skip });
  return NextResponse.json({ items, eligible: items.filter((i) => i.eligible).length });
});
