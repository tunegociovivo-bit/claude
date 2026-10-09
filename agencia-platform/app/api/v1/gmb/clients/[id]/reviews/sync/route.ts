/** POST /api/v1/gmb/clients/[id]/reviews/sync — importa ya las reseñas de la ficha desde Google. Tenant-scoped. */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { syncClientReviews } from "@/lib/gmb/review-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = withApi({ scope: "*" }, async (_req, { params, api }) => {
  try {
    const r = await syncClientReviews(api.workspaceId, (params as any).id);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ ok: false, message: String(e?.message ?? e).slice(0, 300) });
  }
});
