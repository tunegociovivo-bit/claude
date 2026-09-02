import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { cronAuthOk } from "@/lib/cron-auth";
import { shouldRunMonthlySchedule } from "@/lib/accountancy-invoices/domain";
import { createAccountancyInvoiceRun } from "@/lib/accountancy-invoices/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!cronAuthOk(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 503 });
  const now = new Date();
  const schedules = await prisma.accountancyInvoiceSchedule.findMany({ where: { enabled: true } });
  const created: string[] = [];
  for (const schedule of schedules) {
    if (!shouldRunMonthlySchedule(now, schedule, schedule.lastRunMonth)) continue;
    const run = await createAccountancyInvoiceRun(schedule.workspaceId, "SCHEDULED", now);
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: schedule.timezone, year: "numeric", month: "2-digit" }).format(now).slice(0, 7);
    await prisma.accountancyInvoiceSchedule.update({ where: { id: schedule.id }, data: { lastRunMonth: local } });
    created.push(run.id);
  }
  return NextResponse.json({ ok: true, created });
}
