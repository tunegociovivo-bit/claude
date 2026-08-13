/**
 * /api/v1/facturacion/recurring — recurrencias importadas de Holded (admin, tenant-scoped).
 *   GET  → lista de plantillas (activas/pausadas).
 *   POST → import desde Holded. body { dryRun?: boolean }. Por defecto dryRun=true (SEGURO:
 *          solo previsualiza). Con dryRun:false crea plantillas PAUSADAS (no emite nada).
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { previewHoldedRecurring, importHoldedRecurringPaused, listRecurringTemplates } from "@/lib/invoicing/holded-recurring-import";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*", rate: "admin", admin: true }, async (_req, { api }) => {
  await requireAdmin(api);
  const templates = await listRecurringTemplates(api.workspaceId);
  return NextResponse.json({
    templates,
    summary: { total: templates.length, active: templates.filter((t) => t.status === "active").length, paused: templates.filter((t) => t.status === "paused").length }
  });
});

export const POST = withApi({ scope: "*", rate: "admin", admin: true }, async (req, { api }) => {
  await requireAdmin(api);
  const body = await req.json().catch(() => ({}));
  // Fail-safe: si no se especifica, es DRY-RUN (nunca escribe por accidente).
  const dryRun = body?.dryRun !== false;
  try {
    if (dryRun) {
      const preview = await previewHoldedRecurring(api.workspaceId);
      return NextResponse.json({ dryRun: true, ...preview });
    }
    const result = await importHoldedRecurringPaused(api.workspaceId);
    console.info(`[recurring-import] ws=${api.workspaceId} imported=${result.imported} skipped=${result.skipped} by=${api.userId ?? "?"}`);
    return NextResponse.json({ dryRun: false, ...result, note: "Plantillas creadas PAUSADAS; actívalas gradualmente para empezar a emitir." });
  } catch (e: any) {
    // Sin PII/secretos: solo un marcador y el mensaje acotado de Holded (no la clave).
    return NextResponse.json({ error: { code: "holded_error", message: String(e?.message ?? "error").slice(0, 200) } }, { status: 502 });
  }
});
