import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { reconciliationDashboard } from "@/lib/facturacion/reconciliation/service";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api);
  return NextResponse.json(await reconciliationDashboard(api.workspaceId));
});
