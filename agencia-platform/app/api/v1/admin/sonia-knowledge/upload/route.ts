/**
 * POST /api/v1/admin/sonia-knowledge/upload  (multipart: file, title?)
 * Sube un documento de cliente (PDF/DOCX/XLSX/TXT…), extrae su texto, lo
 * guarda como entrada de conocimiento de Sonia y lo indexa para búsqueda.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { isStorageEnabled, uploadBuffer, buildS3Key } from "@/lib/storage/r2";
import { extractTextFromFile } from "@/lib/ai/nv-ia/file-reader";
import { indexEntity } from "@/lib/search/embeddings";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const runtime = "nodejs";

export const POST = withApi({ scope: "admin" }, async (req, { api }) => {
  if (!isStorageEnabled()) {
    throw new ApiError(503, "no_storage", "Almacenamiento no configurado (STORAGE_* en env).");
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, "bad_multipart", "Se esperaba multipart/form-data con un archivo");
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new ApiError(400, "no_file", "Falta el archivo");
  const filename = (file as any).name ?? "documento";
  const mimeType = file.type || "application/octet-stream";
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length === 0) throw new ApiError(400, "empty_file", "El archivo está vacío");

  // Subir a R2
  const s3Key = buildS3Key({
    workspaceId: api.workspaceId,
    targetType: "sonia-knowledge",
    targetId: "doc",
    filename
  });
  await uploadBuffer({ s3Key, body: buf, contentType: mimeType });

  // Extraer texto
  const extracted = await extractTextFromFile({ s3Key, mimeType, filename, sizeBytes: buf.length });
  if (!extracted.ok) {
    throw new ApiError(422, "extract_failed", extracted.error);
  }
  if (!extracted.text.trim()) {
    throw new ApiError(422, "empty_text", "No se pudo extraer texto del documento (¿es un PDF escaneado/imagen?).");
  }

  const title = String(form.get("title") ?? "").trim() || filename;
  const entry = await prisma.soniaKnowledge.create({
    data: {
      workspaceId: api.workspaceId,
      title,
      content: extracted.text,
      sourceType: "document",
      fileName: filename,
      createdById: api.userId ?? null
    }
  });
  await indexEntity({
    workspaceId: api.workspaceId,
    entityType: "SONIA_KNOWLEDGE",
    entityId: entry.id,
    text: `${title}\n\n${extracted.text}`
  }).catch(() => {});

  return NextResponse.json({
    id: entry.id,
    title,
    fileName: filename,
    chars: extracted.text.length,
    truncated: extracted.truncated
  });
});
