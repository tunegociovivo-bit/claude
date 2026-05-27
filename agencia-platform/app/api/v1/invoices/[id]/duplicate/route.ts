import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";

export const POST = withApi({ scope: "*", rate: "admin" }, async (_req, { api, params }) => {
  await requireAdmin(api);
  const src = await prisma.invoice.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null }
  });
  if (!src) throw new ApiError(404, "not_found", "Factura no encontrada");

  const copy = await prisma.invoice.create({
    data: {
      workspaceId: api.workspaceId,
      type: src.type,
      status: "DRAFT",
      series: src.series,
      number: null, // se asigna al emitir
      issuerId: src.issuerId,
      clientId: src.clientId,
      issuerSnapshot: src.issuerSnapshot ?? undefined,
      clientSnapshot: src.clientSnapshot ?? undefined,
      issueDate: new Date(),
      dueDate: null,
      currency: src.currency,
      paymentMethod: src.paymentMethod,
      lines: src.lines ?? [],
      subtotalCents: src.subtotalCents,
      discountCents: src.discountCents,
      taxCents: src.taxCents,
      totalCents: src.totalCents,
      paidCents: 0,
      notes: src.notes,
      terms: src.terms
    }
  });
  return NextResponse.json(copy, { status: 201 });
});
