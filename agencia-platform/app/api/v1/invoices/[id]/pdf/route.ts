import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import type { InvoiceParty } from "@/lib/invoicing/invoice-html";
import { buildInvoicePdf } from "@/lib/invoicing/invoice-pdf";
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

  const pdf = await buildInvoicePdf({
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
    });

  const filename = `${inv.number ?? "factura"}.pdf`.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(pdf as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store"
    }
  }) as any;
});
