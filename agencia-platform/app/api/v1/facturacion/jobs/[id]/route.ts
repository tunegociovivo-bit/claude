/** Trabajo bancario — eliminación definitiva de trabajos inactivos. ADMIN + CSRF. */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/auth";
import { assertSameOrigin } from "@/lib/api/csrf";
import { deleteJob } from "@/lib/facturacion/sepa/agent";

export const dynamic = "force-dynamic";

export const DELETE = withApi({ scope: "*", rate: "admin" }, async (req, { params, api }) => {
  await requireAdmin(api);
  assertSameOrigin(req);
  try {
    await deleteJob(api.workspaceId, String(params.id));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    throw new ApiError(409, "delete_failed", String(error?.message ?? error));
  }
});
