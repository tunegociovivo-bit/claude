/**
 * POST /api/v1/admin/meta-invoices/ingest
 *
 * Recibe una factura de Meta en PDF (multipart) y la archiva como Gasto de
 * Publicidad (categoría PUBLICIDAD, proveedor Meta), idempotente por número.
 * La usa la extensión de Chrome (recolector automático, Bearer) y la subida
 * manual desde Facturación → Gastos (sesión admin). Solo administradores.
 *
 * Multipart:
 *   file          (PDF)
 *   adAccount     (opcional, pista del nombre de la cuenta)
 *   copyToDrive   (opcional "1"/"0", default 1)
 */
import { NextResponse, type NextRequest } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { ingestMetaInvoice } from "@/lib/import/meta-invoice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 15 * 1024 * 1024;

export const POST = withApi({ scope: "*", rate: "admin" }, async (req: NextRequest, { api }) => {
  await requireAdmin(api);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new ApiError(400, "no_file", "Falta el PDF de la factura");
  if (file.size === 0) throw new ApiError(400, "empty", "Archivo vacío");
  if (file.size > MAX_BYTES) throw new ApiError(413, "too_large", "PDF demasiado grande (>15MB)");

  const buf = Buffer.from(await file.arrayBuffer());
  const filename = (file as any).name ?? "meta-factura.pdf";
  const mimeType = file.type || "application/pdf";
  const hintAdAccount = typeof form.get("adAccount") === "string" ? String(form.get("adAccount")) : undefined;
  const copyToDrive = form.get("copyToDrive") !== "0";

  // ¿Es un ZIP? (la descarga "todas las transacciones" de Meta es un ZIP).
  // Detección por firma PK\x03\x04 — robusta frente al mime/extensión.
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05);
  if (isZip) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buf);
    const entries = Object.values(zip.files).filter(
      (f: any) => !f.dir && /\.pdf$/i.test(f.name)
    ) as any[];
    let created = 0;
    let duplicate = 0;
    let errored = 0;
    for (const entry of entries) {
      try {
        const pdfBuf = Buffer.from(await entry.async("nodebuffer"));
        const r = await ingestMetaInvoice({
          workspaceId: api.workspaceId,
          buf: pdfBuf,
          filename: entry.name.split("/").pop() || "meta-factura.pdf",
          mimeType: "application/pdf",
          uploadedBy: api.userId,
          hintAdAccount,
          copyToDrive
        });
        if (r.action === "created") created++;
        else if (r.action === "duplicate") duplicate++;
        else errored++;
      } catch {
        errored++;
      }
    }
    return NextResponse.json({ action: "batch", total: entries.length, created, duplicate, error: errored });
  }

  const result = await ingestMetaInvoice({
    workspaceId: api.workspaceId,
    buf,
    filename,
    mimeType,
    uploadedBy: api.userId,
    hintAdAccount,
    copyToDrive
  });
  // Contadores uniformes para que el cliente sume igual que con ZIP.
  return NextResponse.json({
    ...result,
    created: result.action === "created" ? 1 : 0,
    duplicate: result.action === "duplicate" ? 1 : 0,
    error: result.action === "error" ? 1 : 0
  });
});
