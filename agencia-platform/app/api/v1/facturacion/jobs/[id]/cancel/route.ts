/**
 * Trabajo bancario — cancelar (no si ya está pendiente de firma). ADMIN + CSRF.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/auth";
import { assertSameOrigin } from "@/lib/api/csrf";
import { cancelJob } from "@/lib/facturacion/sepa/agent";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { params, api }) => {
  await requireAdmin(api);
  assertSameOrigin(req);
  try {
    await cancelJob(api.workspaceId, String(params.id), api.userId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    throw new ApiError(409, "cancel_failed", String(e?.message ?? e));
  }
});
