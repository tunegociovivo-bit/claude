import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { formatInvoiceNumberPreview } from "@/lib/invoicing/invoice-form";
import { normalizeInitialInvoiceSequence } from "@/lib/invoicing/invoice-form";

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

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  const body = await req.json();
  const series = String(body.series || "FAC").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "FAC";
  const year = Number(body.year) || new Date().getFullYear();
  const next = normalizeInitialInvoiceSequence(body.next);
  let currentNext = 1;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      currentNext = await prisma.$transaction(async (tx) => {
        const current = await tx.invoiceCounter.findUnique({
          where: { workspaceId_series_year: { workspaceId: api.workspaceId, series, year } }
        });
        if (current && next < current.next) return current.next;
        await tx.invoiceCounter.upsert({
          where: { workspaceId_series_year: { workspaceId: api.workspaceId, series, year } },
          create: { workspaceId: api.workspaceId, series, year, next },
          update: { next }
        });
        return next;
      }, { isolationLevel: "Serializable" });
      break;
    } catch (error: any) {
      if (error?.code !== "P2034" || attempt === 2) throw error;
    }
  }
  if (currentNext > next) {
    return NextResponse.json({ error: { message: `El siguiente número ya es ${currentNext}; no puede retroceder para evitar duplicados.` } }, { status: 409 });
  }
  return NextResponse.json({ number: formatInvoiceNumberPreview(series, year, next) });
});
