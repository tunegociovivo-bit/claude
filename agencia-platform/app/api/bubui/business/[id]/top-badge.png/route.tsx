/**
 * GET /api/bubui/business/[id]/top-badge.png
 *
 * Imagen cuadrada (1080×1080) lista para compartir en Instagram/WhatsApp con
 * la posición del negocio en el ranking Bubui de su ciudad este mes
 * ("🏆 Nº1 en Benalmádena"). Marketing gratis para Bubui y para el negocio.
 *
 * Pública (es una pieza para difundir): el id del negocio basta. No expone
 * datos sensibles, solo nombre + posición + ciudad.
 */
import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db/prisma";
import { getBusinessCityRanking } from "@/lib/bubui/ranking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const business = await prisma.bubuiBusiness.findUnique({
    where: { id: params.id },
    select: { name: true, city: true, brandColor: true, active: true }
  });
  if (!business || !business.active) {
    return new Response("not found", { status: 404 });
  }
  const rank = await getBusinessCityRanking(params.id);
  const pos = rank?.position ?? null;
  const month = new Date().toLocaleDateString("es-ES", { month: "long" });

  // Titular según la posición.
  const medal = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : "⭐";
  const headline =
    pos === 1
      ? `Nº1${business.city ? ` en ${business.city}` : ""}`
      : pos && pos <= 3
        ? `Top ${pos}${business.city ? ` en ${business.city}` : ""}`
        : business.city
          ? `En ${business.city}`
          : "En Bubui";

  return new ImageResponse(
    (
      <div
        style={{
          width: "1080px",
          height: "1080px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #EC4899 0%, #BE185D 100%)",
          color: "#fff",
          fontFamily: "sans-serif",
          padding: "80px",
          textAlign: "center"
        }}
      >
        <div style={{ fontSize: 180, lineHeight: 1 }}>{medal}</div>
        <div style={{ fontSize: 96, fontWeight: 900, marginTop: 24, letterSpacing: -2 }}>{headline}</div>
        <div style={{ fontSize: 64, fontWeight: 800, marginTop: 16, maxWidth: 900 }}>{business.name}</div>
        <div style={{ fontSize: 40, marginTop: 24, opacity: 0.92 }}>
          el negocio más visitado de {month} en Bubui
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 70,
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 44,
            fontWeight: 900,
            letterSpacing: 6
          }}
        >
          bubui
        </div>
      </div>
    ),
    { width: 1080, height: 1080 }
  );
}
