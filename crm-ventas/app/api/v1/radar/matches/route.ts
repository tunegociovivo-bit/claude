import { NextRequest } from "next/server";
import { requireRadarUser, radarError } from "@/lib/radar/api";
import { listMatches } from "@/lib/radar/listings-query";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await requireRadarUser();
    const url = new URL(req.url);
    const result = await listMatches({
      workspaceId: user.workspaceId,
      status: url.searchParams.get("status") ?? undefined,
      searchId: url.searchParams.get("searchId") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: Number(url.searchParams.get("limit")) || undefined,
    });
    return Response.json(result);
  } catch (error) {
    return radarError(error);
  }
}
