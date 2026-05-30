/**
 * POST /api/bubui/admin/banner/upload  (cabecera x-admin-token)
 *
 * Sube un archivo de imagen para el banner del Home y devuelve su URL
 * pública, lista para guardarla con PUT /api/bubui/admin/banner.
 *
 * Body: multipart/form-data con campo "file".
 *
 * Requiere STORAGE_PUBLIC_URL (R2/S3 con dominio público): el banner lo
 * consume la app móvil y la web, así que la URL debe ser permanente, no
 * firmada temporalmente.
 */

import { NextResponse } from "next/server";
import { adminTokenOk } from "@/lib/bubui/admin";
import { isStorageEnabled, uploadBuffer } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export async function POST(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  if (!isStorageEnabled()) {
    return NextResponse.json(
      { error: { code: "storage_disabled", message: "Storage no configurado (define STORAGE_* en env)." } },
      { status: 503 }
    );
  }
  if (!process.env.STORAGE_PUBLIC_URL) {
    return NextResponse.json(
      {
        error: {
          code: "no_public_url",
          message:
            "Falta STORAGE_PUBLIC_URL. El banner necesita una URL pública permanente; configúrala (dominio público del bucket) o pega la URL de la imagen a mano."
        }
      },
      { status: 503 }
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: { code: "no_file", message: "Falta el campo 'file'." } }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: { code: "empty", message: "Archivo vacío." } }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: { code: "too_large", message: `La imagen supera 8 MB (${(file.size / 1024 / 1024).toFixed(1)} MB).` } },
      { status: 413 }
    );
  }
  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED.includes(mimeType)) {
    return NextResponse.json(
      { error: { code: "bad_type", message: "Formato no soportado. Usa PNG, JPG, WEBP o GIF." } },
      { status: 415 }
    );
  }

  const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const s3Key = `bubui/banner/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  try {
    await uploadBuffer({ s3Key, body: buf, contentType: mimeType });
  } catch (e: any) {
    return NextResponse.json(
      { error: { code: "upload_failed", message: `No se pudo subir: ${e?.message ?? e}` } },
      { status: 502 }
    );
  }

  const base = process.env.STORAGE_PUBLIC_URL.replace(/\/+$/, "");
  const url = `${base}/${s3Key}`;
  return NextResponse.json({ url });
}
