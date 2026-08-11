/**
 * POST /api/v1/facturacion/recurring-templates/import/preview  (Slice A)
 *
 * DRY-RUN: parsea/valida un CSV o JSON de plantillas recurrentes y devuelve el
 * preview con errores por fila y dedupe. NO ESCRIBE NADA. Admin-only, tenant.
 * Body: { format: "csv"|"json", content: string (csv) | records: object[] (json) }
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { recurringInvoicesEnabled } from "@/lib/facturacion/recurring/flags";
import { previewCsv, previewJson } from "@/lib/facturacion/recurring/import";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2_000_000; // 2 MB

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  if (!recurringInvoicesEnabled()) {
    return NextResponse.json({ error: { code: "disabled", message: "Módulo de recurrentes desactivado" } }, { status: 404 });
  }
  await requireAdmin(api);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: { code: "bad_request", message: "JSON inválido" } }, { status: 400 });
  }
  try {
    if (body.format === "csv") {
      const content = typeof body.content === "string" ? body.content : "";
      if (content.length > MAX_BYTES) return NextResponse.json({ error: { code: "too_large", message: "CSV demasiado grande" } }, { status: 413 });
      return NextResponse.json(previewCsv(content));
    }
    if (body.format === "json") {
      const records = Array.isArray(body.records) ? body.records : [];
      if (JSON.stringify(records).length > MAX_BYTES) return NextResponse.json({ error: { code: "too_large", message: "JSON demasiado grande" } }, { status: 413 });
      return NextResponse.json(previewJson(records));
    }
    return NextResponse.json({ error: { code: "bad_request", message: "format debe ser 'csv' o 'json'" } }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: { code: "parse_error", message: String(e?.message ?? e).slice(0, 200) } }, { status: 400 });
  }
});
