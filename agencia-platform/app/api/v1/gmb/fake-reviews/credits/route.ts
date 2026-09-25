/** GET /api/v1/gmb/fake-reviews/credits → búsquedas SerpApi disponibles (no consume créditos). */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { getSerpApiKey, serpApiAccount } from "@/lib/integrations/serpapi";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const key = await getSerpApiKey(api.workspaceId);
  if (!key) return NextResponse.json({ configured: false });
  try {
    const acc = await serpApiAccount(key);
    return NextResponse.json({ configured: true, ...acc });
  } catch (e) {
    return NextResponse.json({ configured: true, left: null, plan: "", error: (e as Error).message });
  }
});
