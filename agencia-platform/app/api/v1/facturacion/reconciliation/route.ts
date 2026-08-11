import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { reconciliationDashboard, requestReconciliation } from "@/lib/facturacion/reconciliation/service";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api);
  return NextResponse.json(await reconciliationDashboard(api.workspaceId));
});

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api);
  const config = await requestReconciliation(api.workspaceId);
  return NextResponse.json({ ok: true, requested: true, lastSyncAt: config.lastSyncAt });
});
