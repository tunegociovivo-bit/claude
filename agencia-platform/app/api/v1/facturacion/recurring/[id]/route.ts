/**
 * PATCH /api/v1/facturacion/recurring/[id] — pausa/activa UNA plantilla (admin, tenant-scoped).
 * body { action: "pause" | "resume" }. "resume" = activación gradual (recurring:true).
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { z } from "zod";
import { setTemplatePaused, updateRecurringTemplate } from "@/lib/invoicing/holded-recurring-import";

export const dynamic = "force-dynamic";

export const PATCH = withApi({ scope: "*", rate: "admin", admin: true }, async (req, { api, params }) => {
  await requireAdmin(api);
  const id = String((params as any)?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: { code: "bad_request", message: "id requerido" } }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");
  if (action === "pause" || action === "resume") {
    const res = await setTemplatePaused(api.workspaceId, id, action === "pause");
    if (!res.ok) return NextResponse.json({ error: { code: "not_found", message: "Plantilla no encontrada" } }, { status: 404 });
    console.info(`[recurring] ws=${api.workspaceId} id=${id} ${action} by=${api.userId ?? "?"}`);
    return NextResponse.json({ ok: true, id, status: action === "pause" ? "paused" : "active" });
  }
  const parsed = z.object({
    intervalUnit: z.enum(["DAYS", "MONTHS", "YEARS"]),
    intervalValue: z.number().int().min(1).max(3650),
    recipientEmail: z.string().email(),
    totalCents: z.number().int().min(0).max(100_000_000_00),
    currency: z.enum(["EUR", "USD"]),
    nextRunAt: z.string().datetime(),
    sendAutomatically: z.boolean(),
    contactName: z.string().max(200).optional(),
    description: z.string().max(2000).optional()
  }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "bad_request", message: parsed.error.issues[0]?.message ?? "Datos inválidos" } }, { status: 400 });
  const res = await updateRecurringTemplate(api.workspaceId, id, parsed.data);
  if (!res.ok) return NextResponse.json({ error: { code: "not_found", message: "Plantilla no encontrada" } }, { status: 404 });
  console.info(`[recurring] ws=${api.workspaceId} id=${id} updated by=${api.userId ?? "?"}`);
  return NextResponse.json({ ok: true, id });
});
