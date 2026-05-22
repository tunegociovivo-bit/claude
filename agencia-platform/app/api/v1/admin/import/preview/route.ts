import { NextResponse, type NextRequest } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { parseFile } from "@/lib/import/parse";
import { extractClientInputs, buildClientPlan } from "@/lib/import/clients";
import { extractInvoiceInputs, buildInvoicePlan } from "@/lib/import/invoices";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

export const POST = withApi({ scope: "*", rate: "admin" }, async (req: NextRequest, { api }) => {
  await requireAdmin(api);

  const form = await req.formData();
  const file = form.get("file");
  const entity = String(form.get("entity") || "clients");
  if (!(file instanceof Blob)) throw new ApiError(400, "no_file", "Falta el archivo");
  if (file.size === 0) throw new ApiError(400, "empty", "Archivo vacío");
  if (file.size > MAX_BYTES) {
    throw new ApiError(413, "too_large", `Archivo > 15 MB (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const filename = (file as any).name ?? "upload";
  const mime = file.type ?? "";

  let parsed;
  try {
    parsed = await parseFile(buf, filename, mime);
  } catch (e: any) {
    throw new ApiError(400, "parse_error", e?.message ?? "No se pudo leer el archivo");
  }

  try {
    if (entity === "invoices") {
      const inputs = await extractInvoiceInputs(api.workspaceId, parsed);
      const plan = await buildInvoicePlan(api.workspaceId, inputs);
      return NextResponse.json({ entity, format: parsed.format, count: inputs.length, inputs, plan });
    }
    const inputs = await extractClientInputs(api.workspaceId, parsed);
    const plan = await buildClientPlan(api.workspaceId, inputs);
    return NextResponse.json({ entity, format: parsed.format, count: inputs.length, inputs, plan });
  } catch (e: any) {
    throw new ApiError(400, "extract_error", e?.message ?? "No se pudieron extraer los datos");
  }
});
