/**
 * GET /api/bubui/banner-image/[id]
 *
 * Sirve una imagen guardada en la BD (modelo BubuiImage). Es el fallback de
 * almacenamiento cuando no hay bucket S3/R2 configurado: la sube
 * /api/bubui/admin/banner/upload y la consumen el banner del Home (app móvil
 * y web). Público y cacheable (la imagen es inmutable: id único por subida).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const img = await prisma.bubuiImage.findUnique({ where: { id: params.id } });
  if (!img) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }
  const body = Buffer.from(img.data);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": img.mimeType || "image/png",
      "Content-Length": String(body.length),
      // Inmutable: el id cambia en cada subida, así que cachear agresivo.
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}
