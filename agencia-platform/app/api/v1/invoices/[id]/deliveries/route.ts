import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";

export const GET = withApi({ scope: "*", rate: "admin" }, async (_req, { api, params }) => {
  await requireAdmin(api);
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    select: { id: true }
  });
  if (!invoice) throw new ApiError(404, "not_found", "Factura no encontrada");
  const deliveries = await prisma.invoiceDelivery.findMany({
    where: { workspaceId: api.workspaceId, invoiceId: invoice.id },
    orderBy: { createdAt: "desc" },
    include: { events: { orderBy: { eventAt: "desc" }, take: 10 } }
  });
  return NextResponse.json({ deliveries });
});
