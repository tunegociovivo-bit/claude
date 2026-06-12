/**
 * Imagen Open Graph del enlace de invitación /bubui/r/<code> (1200×630).
 * Es la tarjeta que se ve al compartir por WhatsApp/redes: gancho visual con
 * el negocio de origen y el % de bienvenida. next/og, sin dependencias extra.
 */
import { ImageResponse } from "next/og";
import { getReferralInvite } from "@/lib/bubui/referral";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: { code: string } }) {
  const invite = await getReferralInvite(params.code).catch(() => null);

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
        <div style={{ fontSize: 130, lineHeight: 1 }}>🎁</div>
        <div style={{ fontSize: 64, fontWeight: 900, marginTop: 18, letterSpacing: -1 }}>
          Un amigo te invita a Bubui
        </div>
        {invite ? (
          <div style={{ fontSize: 40, marginTop: 18, opacity: 0.95, maxWidth: 1000 }}>
            Llévate un <b>{invite.welcomePct}% de bienvenida</b> en {invite.businessName}
            {invite.city ? ` · ${invite.city}` : ""}
          </div>
        ) : (
          <div style={{ fontSize: 40, marginTop: 18, opacity: 0.95 }}>
            Tu cupón de bienvenida te espera
          </div>
        )}
        <div
          style={{
            position: "absolute",
            bottom: 50,
            fontSize: 40,
            fontWeight: 900,
            letterSpacing: 6
          }}
        >
          bubui
        </div>
      </div>
    ),
    size
  );
}
