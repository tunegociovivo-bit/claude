/**
 * PATCH /api/v1/facturacion/recurring/[id] — pausa/activa UNA plantilla (admin, tenant-scoped).
 * body { action: "pause" | "resume" }. "resume" = activación gradual (recurring:true).
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { setTemplatePaused } from "@/lib/invoicing/holded-recurring-import";

export const dynamic = "force-dynamic";

export const PATCH = withApi({ scope: "*", rate: "admin", admin: true }, async (req, { api, params }) => {
  await requireAdmin(api);
  const id = String((params as any)?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: { code: "bad_request", message: "id requerido" } }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");
  if (action !== "pause" && action !== "resume") {
    return NextResponse.json({ error: { code: "bad_request", message: "action debe ser 'pause' o 'resume'" } }, { status: 400 });
  }
  const res = await setTemplatePaused(api.workspaceId, id, action === "pause");
  if (!res.ok) return NextResponse.json({ error: { code: "not_found", message: "Plantilla no encontrada" } }, { status: 404 });
  console.info(`[recurring] ws=${api.workspaceId} id=${id} ${action} by=${api.userId ?? "?"}`);
  return NextResponse.json({ ok: true, id, status: action === "pause" ? "paused" : "active" });
});
