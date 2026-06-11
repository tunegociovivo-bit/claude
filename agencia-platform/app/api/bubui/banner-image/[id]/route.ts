/**
 * GET /api/bubui/banner-image/[id]
 *
 * Sirve una imagen guardada en la BD (modelo BubuiImage). Es el fallback de
 * almacenamiento cuando no hay bucket S3/R2 configurado: la sube
 * /api/bubui/admin/banner/upload y la consumen el banner del Home (app móvil
 * y web). Público y cacheable (la imagen es inmutable: id único por subida).
 *
 * Param opcional `?w=<px>`: devuelve una versión redimensionada (JPEG) con ese
 * ancho máximo. Se usa para el PUSH: FCM descarta en silencio las imágenes
 * grandes (>~1MB) de las notificaciones, así que el envío pide `?w=1024`, que
 * pesa poco y se entrega de forma fiable como BigPicture en Android.
 */
import { NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const img = await prisma.bubuiImage.findUnique({ where: { id: params.id } });
  if (!img) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }

  const original = Buffer.from(img.data);

  // Variante redimensionada (para el push). GIF no se toca (puede ser animado).
  const wRaw = new URL(req.url).searchParams.get("w");
  const w = wRaw ? Math.min(Math.max(parseInt(wRaw, 10) || 0, 64), 2048) : 0;
  if (w > 0 && img.mimeType !== "image/gif") {
    try {
      const resized = await sharp(original)
        .rotate() // respeta la orientación EXIF
        .resize({ width: w, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      return new NextResponse(new Uint8Array(resized), {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": String(resized.length),
          "Cache-Control": "public, max-age=31536000, immutable"
        }
      });
    } catch {
      // Si sharp falla, caemos al original más abajo.
    }
  }

  return new NextResponse(original, {
    status: 200,
    headers: {
      "Content-Type": img.mimeType || "image/png",
      "Content-Length": String(original.length),
      // Inmutable: el id cambia en cada subida, así que cachear agresivo.
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}
