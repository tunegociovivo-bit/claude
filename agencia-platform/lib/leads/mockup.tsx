/**
 * Generación del mockup "antes/después" de la ficha de Google de un negocio,
 * reutilizable desde:
 *   - GET /api/v1/leads/[id]/mockup        (devuelve el PNG para verlo)
 *   - POST /api/v1/leads/[id]/send-mockup  (lo manda por WhatsApp como imagen)
 *
 * Usa next/og (Satori), sin dependencias extra.
 */

import { ImageResponse } from "next/og";

export type MockupLead = {
  name: string;
  category?: string | null;
  province?: string | null;
  rating?: number | null;
  reviewsCount?: number | null;
};

function stars(rating: number): string {
  const r = Math.round(rating);
  return "★".repeat(Math.max(0, Math.min(5, r))) + "☆".repeat(Math.max(0, 5 - r));
}

function Card({
  title,
  accent,
  rating,
  reviews,
  lines
}: {
  title: string;
  accent: string;
  rating: number;
  reviews: number;
  lines: string[];
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        backgroundColor: "#ffffff",
        borderRadius: 18,
        border: `2px solid ${accent}`,
        padding: 28
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color: accent, marginBottom: 10 }}>{title}</div>
      <div style={{ display: "flex", fontSize: 40, color: "#f59e0b" }}>{stars(rating)}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color: "#111827", marginTop: 4 }}>
        {rating.toFixed(1)} · {reviews} reseñas
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 16 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ fontSize: 22, color: "#374151", marginTop: 6 }}>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Construye el ImageResponse (PNG 1080x1080) del mockup. `photoDataUrl` es la
 *  foto real del negocio (data URL) si se ha podido obtener. */
export function buildMockupImage(lead: MockupLead, photoDataUrl?: string | null): ImageResponse {
  const ratingNow = lead.rating ?? 3.2;
  const reviewsNow = lead.reviewsCount ?? 0;
  const ratingAfter = Math.max(4.6, Math.min(5, ratingNow + 1));
  const reviewsAfter = Math.max(reviewsNow + 35, 40);
  const subtitle = [lead.category, lead.province].filter(Boolean).join("  ·  ");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0f172a",
          padding: 44,
          fontFamily: "sans-serif"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 24 }}>
          {photoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoDataUrl}
              width={120}
              height={120}
              style={{ width: 120, height: 120, borderRadius: 16, objectFit: "cover", marginRight: 20 }}
            />
          ) : null}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 40, fontWeight: 800, color: "#ffffff" }}>{lead.name}</div>
            <div style={{ fontSize: 24, color: "#94a3b8", marginTop: 4 }}>{subtitle}</div>
          </div>
        </div>
        <div style={{ display: "flex", flex: 1, gap: 24 }}>
          <Card
            title="Tu ficha hoy"
            accent="#ef4444"
            rating={ratingNow}
            reviews={reviewsNow}
            lines={["Posición baja en Google", "Pocas reseñas recientes", "Sin gestión de reputación"]}
          />
          <Card
            title="Con Negocio Vivo"
            accent="#10b981"
            rating={ratingAfter}
            reviews={reviewsAfter}
            lines={["Top 3 en tu zona", "Reseñas nuevas cada semana", "Reputación gestionada"]}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: 24,
            fontSize: 26,
            fontWeight: 700,
            color: "#ffffff"
          }}
        >
          negociovivo.app · Optimizamos tu Google y tus reseñas
        </div>
      </div>
    ),
    { width: 1080, height: 1080 }
  );
}

/** Devuelve el PNG del mockup como Buffer (para enviarlo por WhatsApp). */
export async function renderMockupPng(lead: MockupLead, photoDataUrl?: string | null): Promise<Buffer> {
  const img = buildMockupImage(lead, photoDataUrl);
  const ab = await img.arrayBuffer();
  return Buffer.from(ab);
}
