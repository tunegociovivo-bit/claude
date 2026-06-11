/**
 * GET   /api/bubui/admin/qr-poster  → { config: { url, qr } | null }
 * PATCH /api/bubui/admin/qr-poster  → body { url, qr?: {x,y,w,h} } | { url: null }
 * (cabecera x-admin-token)
 *
 * Plantilla del cartel QR de marca: el admin sube la imagen (vía el upload
 * de banner) y guarda aquí su URL. A partir de entonces, poster.png de TODOS
 * los comercios usa esta plantilla con su QR compuesto encima. Con url null
 * se desactiva (vuelve el cartel generado por estilos).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { adminTokenOk } from "@/lib/bubui/admin";
import { getQrPosterConfig, setQrPosterConfig } from "@/lib/bubui/qr-poster";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  return NextResponse.json({ config: await getQrPosterConfig() });
}

const frac = z.number().gt(0).lt(1);
const schema = z.object({
  url: z.string().url().nullable(),
  qr: z.object({ x: frac, y: frac, w: frac, h: frac }).partial().optional()
});

export async function PATCH(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  }
  if (parsed.data.url === null) {
    await prisma.bubuiSetting.deleteMany({ where: { key: "qr_poster_template" } });
    return NextResponse.json({ config: null });
  }
  const config = await setQrPosterConfig({ url: parsed.data.url, qr: parsed.data.qr });
  return NextResponse.json({ config });
}
