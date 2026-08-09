/**
 * GET /api/bubui/custom-deal/[token]
 *
 * Info pública de un reto personalizado (para la página /reto/[token] que abre
 * el cliente y para la app). No requiere auth. Usa el helper compartido
 * getCustomDealPublic (misma fuente que el preview de WhatsApp y la imagen OG).
 */
import { NextResponse } from "next/server";
import { getCustomDealPublic } from "@/lib/bubui/custom-deal";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const deal = await getCustomDealPublic(params.token);
  if (!deal) return NextResponse.json({ error: { code: "not_found", message: "Reto no encontrado" } }, { status: 404 });
  return NextResponse.json({ ...deal, claimedByMe: false });
}
