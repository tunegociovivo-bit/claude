import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { assertSameOrigin } from "@/lib/api/csrf";
import { ApiError } from "@/lib/api/auth";
import { confirmRemittancesSigned } from "@/lib/facturacion/sepa/signature-confirmation";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  assertSameOrigin(req);
  const body = await req.json().catch(() => null);
  if (body?.confirmation !== "CONFIRM_SIGNED") {
    throw new ApiError(400, "confirmation_required", "Falta la confirmación explícita de firma");
  }
  const requestIds = Array.isArray(body?.requestIds)
    ? body.requestIds.filter((id: unknown): id is string => typeof id === "string").slice(0, 100)
    : [];
  try {
    const result = await confirmRemittancesSigned(
      api.workspaceId,
      { requestIds, allPendingSignature: body?.allPendingSignature === true },
      api.userId ?? null
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    throw new ApiError(400, "signature_confirmation_failed", String(error?.message ?? error));
  }
});
