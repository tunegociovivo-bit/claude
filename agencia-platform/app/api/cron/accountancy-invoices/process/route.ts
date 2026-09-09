import { NextRequest, NextResponse } from "next/server";
import { cronAuthOk } from "@/lib/cron-auth";
import { prisma } from "@/lib/db/prisma";
import { runManualInvoiceProcessors } from "@/lib/accountancy-invoices/manual-run";
import { processAllPendingGoogleAdsInvoiceRun, processAllPendingMetaInvoiceRun, processPendingHoldedInvoiceRun } from "@/lib/accountancy-invoices/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!cronAuthOk(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 503 });
  const staleBefore = new Date(Date.now() - 20 * 60_000);
  await prisma.accountancyInvoiceRunItem.updateMany({
    where: { status: "RUNNING", startedAt: { lt: staleBefore } },
    data: { status: "PENDING", startedAt: null, error: "Reintentado tras interrupción del procesador" }
  });
  await runManualInvoiceProcessors("", [
    () => processPendingHoldedInvoiceRun(),
    () => processAllPendingGoogleAdsInvoiceRun(undefined, 2),
    () => processAllPendingMetaInvoiceRun(undefined, 4)
  ]);
  return NextResponse.json({ ok: true });
}
