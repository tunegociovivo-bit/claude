/**
 * Trabajo bancario — log de eventos (SANEADO, sin datos sensibles). Solo ADMIN.
 *  GET → { items }
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { jobEvents } from "@/lib/facturacion/sepa/agent";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await requireAdmin(api);
  return NextResponse.json({ items: await jobEvents(api.workspaceId, String(params.id)) });
});
