/**
 * Imagen Open Graph del reto /reto/<token> (1200×630). Es la tarjeta que se ve
 * al compartir por WhatsApp/redes: negocio + descuento del reto. next/og, sin
 * dependencias extra. Absoluta y verificable sin JavaScript.
 */
import { ImageResponse } from "next/og";
import { getCustomDealPublic } from "@/lib/bubui/custom-deal";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: { token: string } }) {
  const deal = await getCustomDealPublic(params.token).catch(() => null);
  const what = deal?.title ? ` en ${deal.title}` : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #EC4899 0%, #BE185D 100%)",
          color: "#fff",
          fontFamily: "sans-serif",
          padding: "70px",
          textAlign: "center"
        }}
      >
        <div style={{ fontSize: 120, lineHeight: 1 }}>🎁</div>
        <div style={{ fontSize: 60, fontWeight: 900, marginTop: 16, letterSpacing: -1, maxWidth: 1040 }}>
          {deal ? `${deal.businessName} te propone un reto` : "Un reto te espera en Bubui"}
        </div>
        {deal ? (
          <div style={{ fontSize: 40, marginTop: 18, opacity: 0.96, maxWidth: 1000 }}>
            Consigue un <b>{deal.clientDiscountPct}%{what}</b>
            {deal.city ? ` · ${deal.city}` : ""}
          </div>
        ) : (
          <div style={{ fontSize: 40, marginTop: 18, opacity: 0.96 }}>Acéptalo y ahorra con tus amigos</div>
        )}
        <div style={{ position: "absolute", bottom: 50, fontSize: 40, fontWeight: 900, letterSpacing: 6 }}>bubui</div>
      </div>
    ),
    size
  );
}
