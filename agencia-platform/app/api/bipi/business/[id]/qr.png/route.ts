/**
 * GET /api/bipi/business/[id]/qr.png
 *
 * Devuelve el PNG del QR del negocio listo para imprimir. El QR codifica
 * la URL de scan que abre la app cuando un cliente lo escanea.
 */

import { NextResponse } from "next/server";
import { generateBusinessQrPng } from "@/lib/bipi/core";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const business = await prisma.bubuiBusiness.findUnique({ where: { id: params.id } });
  if (!business) {
    return new NextResponse("Not found", { status: 404 });
  }
  const baseUrl = new URL(req.url).origin;
  const png = await generateBusinessQrPng({ businessId: business.id, baseUrl, size: 800 });
  return new NextResponse(png as any, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}
