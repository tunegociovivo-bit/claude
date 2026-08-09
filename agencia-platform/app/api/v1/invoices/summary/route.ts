import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { buildReceivablesSummary } from "@/lib/invoicing/receivables";

export const GET = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  const params = new URL(req.url).searchParams;
  const issuerId = params.get("issuerId") ?? undefined;
  const fromValue = params.get("from");
  const from = fromValue ? new Date(fromValue) : null;
  const validFrom = from && !Number.isNaN(from.getTime()) ? from : undefined;
  const invoices = await prisma.invoice.findMany({
    where: {
      workspaceId: api.workspaceId,
      deletedAt: null,
      issuerId,
      issueDate: validFrom ? { gte: validFrom } : undefined
    },
    select: {
      type: true,
      status: true,
      totalCents: true,
      paidCents: true,
      issueDate: true,
      dueDate: true
    }
  });

  return NextResponse.json(buildReceivablesSummary(invoices));
});
