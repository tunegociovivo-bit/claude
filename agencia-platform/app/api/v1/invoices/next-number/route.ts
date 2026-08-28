import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { formatInvoiceNumberPreview } from "@/lib/invoicing/invoice-form";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  const url = new URL(req.url);
  const series = (url.searchParams.get("series") || "FAC").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "FAC";
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
  const counter = await prisma.invoiceCounter.findUnique({
    where: { workspaceId_series_year: { workspaceId: api.workspaceId, series, year } },
    select: { next: true }
  });
  return NextResponse.json({ number: formatInvoiceNumberPreview(series, year, counter?.next ?? 1) });
});
