/** GET /api/v1/gmb/shield/stats → qué funciona: tasa real de retirada por motivo, destino y vía. */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { getLearningStats } from "@/lib/gmb/fake-reviews/shield";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  return NextResponse.json({ stats: await getLearningStats(api.workspaceId) });
});
