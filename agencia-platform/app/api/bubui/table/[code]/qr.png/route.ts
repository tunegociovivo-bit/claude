/**
 * GET /api/bubui/table/[code]/qr.png
 *
 * QR de mesa que muestra el anfitrión en su app; el resto de comensales lo
 * escanean para unirse (abre /bubui/app/mesa?code=XXXX).
 */
import { NextResponse } from "next/server";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { code: string } }) {
  const code = params.code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (!code) return new NextResponse("Bad code", { status: 400 });
  const origin = new URL(req.url).origin;
  const url = `${origin}/bubui/app/mesa?code=${code}`;
  const png = await QRCode.toBuffer(url, { type: "png", width: 600, margin: 2, errorCorrectionLevel: "H" });
  return new NextResponse(png as any, {
    status: 200,
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" }
  });
}
