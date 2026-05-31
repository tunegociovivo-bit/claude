/**
 * POST /api/bubui/admin/banner/upload  (cabecera x-admin-token)
 *
 * Sube un archivo de imagen para el banner del Home y devuelve su URL
 * pública, lista para guardarla con PUT /api/bubui/admin/banner.
 *
 * Body: multipart/form-data con campo "file".
 *
 * Almacenamiento: si hay bucket S3/R2 con STORAGE_PUBLIC_URL configurado, sube
 * ahí. Si no, guarda la imagen en la BD (BubuiImage) y devuelve una URL
 * absoluta servida por /api/bubui/banner-image/<id> — así funciona sin
 * configurar nada externo.
 */

import { NextResponse } from "next/server";
import { adminTokenOk } from "@/lib/bubui/admin";
import { prisma } from "@/lib/db/prisma";
import { isStorageEnabled, uploadBuffer } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB (bucket)
const MAX_DB_BYTES = 2 * 1024 * 1024; // 2 MB (fallback en BD)
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * Origin público (https://dominio) para construir URLs absolutas servibles
 * desde fuera (app móvil + web). Detrás del proxy de Railway, `req.url` trae
 * el host interno del contenedor, así que priorizamos las cabeceras
 * x-forwarded-* y, si no, una env con el dominio público.
 */
function publicOrigin(req: Request): string {
  const h = req.headers;
  const xfHost = h.get("x-forwarded-host") || h.get("host");
  const xfProto = h.get("x-forwarded-proto") || "https";
  // Hosts internos típicos del contenedor → no son públicos.
  const looksInternal = xfHost ? /^(localhost|127\.|0\.0\.0\.0|\[|[0-9a-f]{8,})/i.test(xfHost) || xfHost.includes(":8080") : true;
  if (xfHost && !looksInternal) return `${xfProto}://${xfHost}`;
  const envUrl = process.env.NEXT_PUBLIC_BUBUI_URL || process.env.HUB_BASE_URL;
  if (envUrl) return envUrl.replace(/\/+$/, "");
  return "https://hub.negociovivo.app";
}

export async function POST(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  // Modo bucket (si está configurado con URL pública) o fallback a BD.
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
          message: `La imagen supera ${(maxBytes / 1024 / 1024).toFixed(0)} MB (${(file.size / 1024 / 1024).toFixed(
            1
          )} MB).${useBucket ? "" : " Usa una imagen más ligera o configura un bucket para archivos grandes."}`
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

  // ── Fallback en BD (sin bucket): guarda los bytes y devuelve URL absoluta ──
  if (!useBucket) {
    const row = await prisma.bubuiImage.create({ data: { mimeType, data: buf } });
    // El origin debe ser el dominio PÚBLICO (lo consume también la app móvil),
    // no el host interno del contenedor. Detrás del proxy de Railway, req.url
    // trae el host interno (p.ej. cfc...:8080), así que preferimos las
    // cabeceras x-forwarded-* y, en última instancia, el dominio configurado.
    const origin = publicOrigin(req);
    return NextResponse.json({ url: `${origin}/api/bubui/banner-image/${row.id}` });
  }

  // ── Modo bucket S3/R2 ──
  const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const s3Key = `bubui/banner/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
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
