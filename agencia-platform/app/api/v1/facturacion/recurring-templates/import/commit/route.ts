/**
 * POST /api/v1/facturacion/recurring-templates/import/commit  (Slice A)
 *
 * Persiste las plantillas VÁLIDAS del import como `status:"draft"` de forma
 * IDEMPOTENTE (upsert por workspace+source+externalId; checksum igual = sin
 * cambios). NUNCA emite/envía facturas. Admin-only, tenant. Las filas inválidas
 * se ignoran (se informan en el preview).
 * Body: { format, content|records, source? }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { recurringInvoicesEnabled } from "@/lib/facturacion/recurring/flags";
import { previewCsv, previewJson } from "@/lib/facturacion/recurring/import";
import { commitTemplates } from "@/lib/facturacion/recurring/store";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2_000_000;
const ALLOWED_SOURCES = new Set(["CSV_IMPORT", "HOLDED_IMPORT", "HUB"]);

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  if (!recurringInvoicesEnabled()) {
    return NextResponse.json({ error: { code: "disabled", message: "Módulo de recurrentes desactivado" } }, { status: 404 });
  }
  await requireAdmin(api);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: { code: "bad_request", message: "JSON inválido" } }, { status: 400 });
  }
  const source = ALLOWED_SOURCES.has(body.source) ? body.source : "CSV_IMPORT";

  let preview;
  try {
    if (body.format === "csv") {
      const content = typeof body.content === "string" ? body.content : "";
      if (content.length > MAX_BYTES) return NextResponse.json({ error: { code: "too_large", message: "CSV demasiado grande" } }, { status: 413 });
      preview = previewCsv(content);
    } else if (body.format === "json") {
      const records = Array.isArray(body.records) ? body.records : [];
      if (JSON.stringify(records).length > MAX_BYTES) return NextResponse.json({ error: { code: "too_large", message: "JSON demasiado grande" } }, { status: 413 });
      preview = previewJson(records);
    } else {
      return NextResponse.json({ error: { code: "bad_request", message: "format debe ser 'csv' o 'json'" } }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: { code: "parse_error", message: String(e?.message ?? e).slice(0, 200) } }, { status: 400 });
  }

  const valid = preview.items.filter((i) => i.ok && i.template).map((i) => i.template!);
  const result = await commitTemplates(prisma, api.workspaceId, source, valid, api.userId ?? null);
  return NextResponse.json({ ...result, skippedInvalid: preview.invalid });
});
