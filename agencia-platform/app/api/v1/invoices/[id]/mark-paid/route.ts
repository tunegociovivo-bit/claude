import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api, params }) => {
  await requireAdmin(api);
  const inv = await prisma.invoice.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null }
  });
  if (!inv) throw new ApiError(404, "not_found", "Factura no encontrada");

  const body = await req.json().catch(() => ({}));
  const paid = body?.paid !== false; // por defecto marca como pagada
  const data: any = paid
    ? { status: "PAID", paidAt: new Date(), paidCents: inv.totalCents }
    : { status: inv.number ? "ISSUED" : "DRAFT", paidAt: null, paidCents: 0 };

  const updated = await prisma.invoice.update({ where: { id: inv.id }, data });
  return NextResponse.json(updated);
});
