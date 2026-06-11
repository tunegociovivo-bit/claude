/**
 * POST /api/bubui/business/[id]/upload-photo  (Authorization: Bearer <token negocio>)
 *
 * Sube la imagen de portada del negocio y devuelve su URL pública, lista para
 * guardarla en el perfil (PATCH profile { logoUrl }). Es el equivalente para
 * negocios del upload de banner del admin.
 *
 * Body: multipart/form-data con campo "file".
 *
 * Almacenamiento: bucket S3/R2 si está configurado con STORAGE_PUBLIC_URL;
 * si no, fallback en BD (BubuiImage) servida por /api/bubui/banner-image/<id>.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { isStorageEnabled, uploadBuffer } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB (bucket)
const MAX_DB_BYTES = 2 * 1024 * 1024; // 2 MB (fallback en BD)
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Origin público para construir URLs absolutas (ver upload del admin). */
function publicOrigin(req: Request): string {
  const h = req.headers;
  const xfHost = h.get("x-forwarded-host") || h.get("host");
  const xfProto = h.get("x-forwarded-proto") || "https";
  const looksInternal = xfHost
    ? /^(localhost|127\.|0\.0\.0\.0|\[|[0-9a-f]{8,})/i.test(xfHost) || xfHost.includes(":8080")
    : true;
  if (xfHost && !looksInternal) return `${xfProto}://${xfHost}`;
  const envUrl = process.env.NEXT_PUBLIC_BUBUI_URL || process.env.HUB_BASE_URL;
  if (envUrl) return envUrl.replace(/\/+$/, "");
  return "https://hub.negociovivo.app";
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }

  const useBucket = isStorageEnabled() && !!process.env.STORAGE_PUBLIC_URL;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: { code: "no_file", message: "Falta el campo 'file'." } }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: { code: "empty", message: "Archivo vacío." } }, { status: 400 });
  }
  const maxBytes = useBucket ? MAX_BYTES : MAX_DB_BYTES;
  if (file.size > maxBytes) {
    return NextResponse.json(
      {
        error: {
          code: "too_large",
          message: `La imagen supera ${(maxBytes / 1024 / 1024).toFixed(0)} MB (${(file.size / 1024 / 1024).toFixed(1)} MB). Usa una foto más ligera.`
        }
      },
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

  const buf = Buffer.from(await file.arrayBuffer());

  // ── Fallback en BD (sin bucket) ──
  if (!useBucket) {
    const row = await prisma.bubuiImage.create({ data: { mimeType, data: buf } });
    return NextResponse.json({ url: `${publicOrigin(req)}/api/bubui/banner-image/${row.id}` });
  }

  // ── Modo bucket S3/R2 ──
  const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const s3Key = `bubui/business/${params.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    await uploadBuffer({ s3Key, body: buf, contentType: mimeType });
  } catch (e: any) {
    return NextResponse.json(
      { error: { code: "upload_failed", message: `No se pudo subir: ${e?.message ?? e}` } },
      { status: 502 }
    );
  }
  const base = process.env.STORAGE_PUBLIC_URL!.replace(/\/+$/, "");
  return NextResponse.json({ url: `${base}/${s3Key}` });
}
