/**
 * GET /api/bubui/demo-photo/<leadId>
 *
 * Foto de portada (Google Places) del negocio de un lead, para la landing
 * demo pública /bubui/demo/<leadId>. Proxy server-side: la API key de Google
 * nunca llega al navegador. Cachea 24h (la foto del local no cambia).
 *
 * Público a propósito (la demo se manda por WhatsApp a leads sin cuenta);
 * el cuid del lead hace de clave, igual que en la página de la demo.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getGoogleApiKeyForWorkspace } from "@/lib/leads/google-places";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { leadId: string } }) {
  const lead = await prisma.lead.findUnique({
    where: { id: params.leadId },
    select: { workspaceId: true, rawData: true }
  });
  const photoName = (lead?.rawData as any)?.photos?.[0]?.name as string | undefined;
  if (!lead || !photoName) {
    return NextResponse.json({ error: { code: "no_photo" } }, { status: 404 });
  }

  try {
    const apiKey = await getGoogleApiKeyForWorkspace(lead.workspaceId);
    const url = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=900&maxHeightPx=600&key=${apiKey}`;
    const resp = await fetch(url); // sigue el redirect a la imagen real
    const ct = resp.headers.get("content-type") ?? "";
    if (!resp.ok || !ct.startsWith("image/")) {
      return NextResponse.json({ error: { code: "fetch_failed" } }, { status: 502 });
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length === 0 || buf.length > 5_000_000) {
      return NextResponse.json({ error: { code: "bad_image" } }, { status: 502 });
    }
    return new NextResponse(buf, {
      headers: {
        "Content-Type": ct,
        "Cache-Control": "public, max-age=86400, s-maxage=86400"
      }
    });
  } catch {
    return NextResponse.json({ error: { code: "fetch_failed" } }, { status: 502 });
  }
}
