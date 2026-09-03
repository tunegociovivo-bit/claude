import { NextResponse, type NextRequest } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { prisma } from "@/lib/db/prisma";
import { buildS3Key, isStorageEnabled, signedDownloadUrl, uploadBuffer } from "@/lib/storage/r2";
import { sanitizeCollectorFilename } from "@/lib/accountancy-invoices/collector";

export const runtime = "nodejs";
export const maxDuration = 120;
const MAX_BYTES = 20 * 1024 * 1024;

export const POST = withApi({ scope: "*", rate: "admin" }, async (req: NextRequest, { api }) => {
  await requireAdmin(api);
  if (!isStorageEnabled()) throw new ApiError(503, "storage_disabled", "Storage no configurado");
  const form = await req.formData();
  const itemId = String(form.get("itemId") || "");
  const file = form.get("file");
  if (!(file instanceof Blob) || !itemId) throw new ApiError(400, "bad_upload", "Faltan itemId o PDF");
  if (file.size < 5 || file.size > MAX_BYTES) throw new ApiError(413, "bad_size", "El PDF está vacío o supera 20 MB");
  const item = await prisma.accountancyInvoiceRunItem.findFirst({ where: { id: itemId, run: { workspaceId: api.workspaceId } } });
  if (!item) throw new ApiError(404, "not_found", "Cuenta de ejecución no encontrada");
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf[0] !== 0x25 || buf[1] !== 0x50 || buf[2] !== 0x44 || buf[3] !== 0x46) throw new ApiError(415, "not_pdf", "El archivo no es un PDF válido");
  const name = sanitizeCollectorFilename((file as any).name || "factura.pdf");
  const s3Key = buildS3Key({ workspaceId: api.workspaceId, targetType: "ACCOUNTANCY_RUN_ITEM", targetId: item.id, filename: name });
  await uploadBuffer({ s3Key, body: buf, contentType: "application/pdf" });
  const row = await prisma.file.create({ data: { workspaceId: api.workspaceId, name, mimeType: "application/pdf", sizeBytes: buf.length, s3Key, targetType: "ACCOUNTANCY_RUN_ITEM", targetId: item.id, uploadedBy: api.userId } });
  return NextResponse.json({ id: row.id, name, url: await signedDownloadUrl(s3Key, 7 * 24 * 3600) });
});
