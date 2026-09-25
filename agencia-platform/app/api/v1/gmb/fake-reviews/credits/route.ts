/**
 * GET /api/v1/gmb/fake-reviews/credits → proveedor de reseñas activo (SerpApi o Serper del
 * Publicador SEO) y, con SerpApi, búsquedas disponibles (no consume créditos).
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { serpApiAccount } from "@/lib/integrations/serpapi";
import { describeReviewSource } from "@/lib/gmb/fake-reviews/provider";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const { key, ...info } = await describeReviewSource(api.workspaceId);
  if (!info.provider) return NextResponse.json({ configured: false, ...info });
  if (info.provider !== "serpapi" || !key) return NextResponse.json({ configured: true, left: null, plan: "", ...info });
  try {
    return NextResponse.json({ configured: true, ...info, ...(await serpApiAccount(key)) });
  } catch (e) {
    return NextResponse.json({ configured: true, ...info, left: null, plan: "", error: (e as Error).message });
  }
});
