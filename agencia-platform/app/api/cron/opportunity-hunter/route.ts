import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { cronAuthOk } from "@/lib/cron-auth";
import { scanCommercialOpportunities } from "@/lib/opportunity-hunter/scanner";

export const maxDuration = 300;
export async function GET(req: NextRequest) {
  if (!cronAuthOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const workspaces = await (prisma as any).workspace.findMany({ select: { id: true }, take: 1 });
  const results = [];
  for (const workspace of workspaces) {
    try { results.push({ workspaceId: workspace.id, ...(await scanCommercialOpportunities(prisma, workspace.id, { region: "España", maxResults: 20 })) }); }
    catch (error: any) { results.push({ workspaceId: workspace.id, error: String(error?.message ?? error).slice(0, 300) }); }
  }
  return NextResponse.json({ ok: true, results });
}
