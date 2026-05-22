import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { buildFacturaeXml } from "@/lib/invoicing/facturae";
import { snapshotIssuer, snapshotClient } from "@/lib/invoicing/persist";
import { computeTotals, type InvoiceLine } from "@/lib/invoicing/core";

export const GET = withApi({ scope: "*", rate: "admin" }, async (_req, { api, params }) => {
  await requireAdmin(api);
  const inv = await prisma.invoice.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    include: { issuer: true, client: true }
  });
  if (!inv) throw new ApiError(404, "not_found", "Factura no encontrada");

  const issuer = (inv.issuerSnapshot as any) ?? snapshotIssuer(inv.issuer);
  const client = (inv.clientSnapshot as any) ?? snapshotClient(inv.client);
  if (!issuer?.taxId) throw new ApiError(400, "missing_issuer", "El emisor no tiene NIF/CIF configurado");
  if (!client?.taxId) throw new ApiError(400, "missing_client_taxid", "El cliente no tiene NIF/CIF; añádelo en su ficha");
  if (!inv.number) throw new ApiError(400, "not_issued", "Emite la factura (asigna número) antes de exportar Facturae");

  const lines = (inv.lines as unknown as InvoiceLine[]) ?? [];
  const xml = buildFacturaeXml({
    number: inv.number,
    issueDate: inv.issueDate,
    currency: inv.currency,
    issuer,
    client,
    lines,
    totals: computeTotals(lines)
  });

  // Cache best-effort del XML generado (para fase 2: firmarlo).
  await prisma.invoice.update({ where: { id: inv.id }, data: { facturaeXml: xml } }).catch(() => {});

  const filename = `facturae-${inv.number}.xml`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  }) as any;
});
