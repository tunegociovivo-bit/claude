/** POST /api/v1/gmb/shield/watches/[id]/run → revisa la ficha ahora mismo. */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { runWatch } from "@/lib/gmb/fake-reviews/watch";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = withApi({ scope: "*", rate: "ai" }, async (_req, { params, api }) => {
  const w = await runWatch(api.workspaceId, params.id, { force: true });
  if (!w) throw new ApiError(404, "not_found", "Vigilancia no encontrada");
  return NextResponse.json({ ok: !w.lastError, lastError: w.lastError, lastRunAt: w.lastRunAt });
});
