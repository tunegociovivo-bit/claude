import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { buildInvoiceHtml, type InvoiceParty } from "@/lib/invoicing/invoice-html";
import { snapshotIssuer, snapshotClient } from "@/lib/invoicing/persist";
import type { InvoiceLine } from "@/lib/invoicing/core";

export const GET = withApi({ scope: "*", rate: "admin" }, async (req, { api, params }) => {
  await requireAdmin(api);
  const inv = await prisma.invoice.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    include: { issuer: true, client: true }
  });
  if (!inv) throw new ApiError(404, "not_found", "Factura no encontrada");

  const issuer = (inv.issuerSnapshot as any) ?? snapshotIssuer(inv.issuer) ?? {};
  const client = (inv.clientSnapshot as any) ?? snapshotClient(inv.client) ?? {};

  const html = buildInvoiceHtml(
    {
      type: inv.type,
      status: inv.status,
      number: inv.number,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      currency: inv.currency,
      paymentMethod: inv.paymentMethod,
      lines: (inv.lines as unknown as InvoiceLine[]) ?? [],
      notes: inv.notes,
      terms: inv.terms,
      issuer: issuer as InvoiceParty,
      client: client as InvoiceParty
    },
    { autoprint: new URL(req.url).searchParams.get("print") === "1" }
  );

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  }) as any;
});
