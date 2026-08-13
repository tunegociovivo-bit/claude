import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { scanCommercialOpportunities } from "@/lib/opportunity-hunter/scanner";

const schema = z.object({ region: z.string().trim().max(120).optional(), maxResults: z.number().int().min(1).max(40).optional() });
export const POST = withApi({ scope: "*", rate: "ai", admin: true }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const db = prisma as any;
  const active = await db.backgroundJob.findFirst({ where: { workspaceId: api.workspaceId, kind: "opportunity_hunter.scan", status: { in: ["PENDING", "RUNNING"] } }, orderBy: { createdAt: "desc" } });
  if (active) return NextResponse.json({ ok: true, jobId: active.id, status: active.status }, { status: 202 });
  const job = await db.backgroundJob.create({ data: { workspaceId: api.workspaceId, userId: api.userId ?? null, kind: "opportunity_hunter.scan", status: "PENDING", progressPct: 0, progressMsg: "En cola…", request: parsed.data } });
  void runScan(job.id, api.workspaceId, parsed.data);
  return NextResponse.json({ ok: true, jobId: job.id, status: "PENDING" }, { status: 202 });
});

export const GET = withApi({ scope: "*", admin: true }, async (req, { api }) => {
  const id = new URL(req.url).searchParams.get("jobId");
  const job = await (prisma as any).backgroundJob.findFirst({ where: { ...(id ? { id } : {}), workspaceId: api.workspaceId, kind: "opportunity_hunter.scan" }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, progressPct: true, progressMsg: true, result: true, errorMessage: true } });
  return NextResponse.json({ job });
});

async function runScan(jobId: string, workspaceId: string, options: z.infer<typeof schema>) {
  const db = prisma as any;
  try {
    await db.backgroundJob.update({ where: { id: jobId }, data: { status: "RUNNING", startedAt: new Date(), progressPct: 10, progressMsg: "Investigando señales y fuentes…" } });
    const result = await scanCommercialOpportunities(prisma, workspaceId, options);
    await db.backgroundJob.update({ where: { id: jobId }, data: { status: "COMPLETED", completedAt: new Date(), progressPct: 100, progressMsg: `${result.accepted} oportunidades incorporadas`, result } });
  } catch (error: any) {
    await db.backgroundJob.update({ where: { id: jobId }, data: { status: "FAILED", completedAt: new Date(), progressPct: 100, progressMsg: "Rastreo fallido", errorMessage: String(error?.message ?? error).slice(0, 2000) } }).catch(() => {});
  }
}
