import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { cronAuthOk } from "@/lib/cron-auth";
import { syncMetaLeadsForAccount } from "@/lib/meta/lead-sync";
import { getUrlLeadSources, syncUrlLeadSource } from "@/lib/meta/url-lead-sync";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!(await cronAuthOk(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const profiles = await prisma.metaClientProfile.findMany({ select: { workspaceId: true, adAccountId: true, metaConnectionId: true, commercialStages: true }, take: 100 });
  const results = [];
  for (const profile of profiles) {
    if (profile.metaConnectionId) {
      try {
        results.push({ kind: "meta", adAccountId: profile.adAccountId, ok: true, ...(await syncMetaLeadsForAccount({ workspaceId: profile.workspaceId, adAccountId: profile.adAccountId, connectionId: profile.metaConnectionId })) });
      } catch (error: any) {
        results.push({ kind: "meta", adAccountId: profile.adAccountId, ok: false, error: String(error?.message ?? error).slice(0, 500) });
      }
    }
    for (const source of getUrlLeadSources(profile.commercialStages).filter((item) => item.enabled)) {
      try {
        results.push({ kind: "url", adAccountId: profile.adAccountId, sourceId: source.id, ok: true, ...(await syncUrlLeadSource({ workspaceId: profile.workspaceId, adAccountId: profile.adAccountId, sourceId: source.id })) });
      } catch (error: any) {
        results.push({ kind: "url", adAccountId: profile.adAccountId, sourceId: source.id, ok: false, error: String(error?.message ?? error).slice(0, 500) });
      }
    }
  }
  return NextResponse.json({ processed: profiles.length, results });
}
