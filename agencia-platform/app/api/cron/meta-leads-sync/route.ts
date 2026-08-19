import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { cronAuthOk } from "@/lib/cron-auth";
import { syncMetaLeadsForAccount } from "@/lib/meta/lead-sync";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!(await cronAuthOk(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const profiles = await prisma.metaClientProfile.findMany({ where: { metaConnectionId: { not: null } }, select: { workspaceId: true, adAccountId: true, metaConnectionId: true }, take: 50 });
  const results = [];
  for (const profile of profiles) {
    try {
      results.push({ adAccountId: profile.adAccountId, ok: true, ...(await syncMetaLeadsForAccount({ workspaceId: profile.workspaceId, adAccountId: profile.adAccountId, connectionId: profile.metaConnectionId! })) });
    } catch (error: any) {
      results.push({ adAccountId: profile.adAccountId, ok: false, error: String(error?.message ?? error).slice(0, 500) });
    }
  }
  return NextResponse.json({ processed: profiles.length, results });
}
