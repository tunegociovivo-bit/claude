/**
 * Tarjeta PNG del ranking de un lead, diseñada para PARECER UNA CAPTURA REAL
 * de los resultados de Google (Maps / local pack): logotipo Google, barra de
 * búsqueda con la consulta, mini-mapa con pines numerados y la lista de fichas
 * con estrellas doradas y reseñas. La ficha del negocio va resaltada y marcada
 * "· Tú". Mucho más creíble en frío que una tarjeta de marca. next/og (Satori).
 *
 * Nota: las fuentes solo traen pesos 400 y 700 (ver og-fonts), así que NO se
 * usan otros pesos. Sin emojis a color (Satori no los cubre sin fuente extra);
 * "★" sí está en Inter.
 */
import { ImageResponse } from "next/og";
import { interFonts } from "./og-fonts";
import type { CompetitorRanking, RankingRow } from "./competitors";

function clip(s: string, n = 30): string {
  const t = (s ?? "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

// Logotipo "Google" en sus 4 colores (letra a letra → spans de color).
const GOOGLE: [string, string][] = [
  ["G", "#4285F4"],
  ["o", "#EA4335"],
  ["o", "#FBBC05"],
  ["g", "#4285F4"],
  ["l", "#34A853"],
  ["e", "#EA4335"]
];

// Posiciones aproximadas de los pines dentro del mini-mapa (left, top).
const PIN_POS: [number, number][] = [
  [120, 36],
  [470, 86],
  [700, 28],
  [860, 96],
  [320, 104],
  [600, 120]
];

function Stars({ rating }: { rating: number | null }) {
  const filled = Math.max(0, Math.min(5, Math.round(rating ?? 0)));
  return (
    <div style={{ display: "flex" }}>
      <div style={{ display: "flex", color: "#FBBC04" }}>{"★".repeat(filled)}</div>
      <div style={{ display: "flex", color: "#DADCE0" }}>{"★".repeat(5 - filled)}</div>
    </div>
  );
}

function Row({ r, category, locality }: { r: RankingRow; category: string; locality: string }) {
  const lead = r.isLead;
  const initial = (r.name || "?").trim().charAt(0).toUpperCase();
  const sub = [clip(category, 16), clip(locality, 18)].filter(Boolean).join(" · ");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "20px 20px",
        borderBottom: "1px solid #ECEDEF",
        backgroundColor: lead ? "#FCE8E6" : "#FFFFFF",
        borderLeft: lead ? "8px solid #EA4335" : "8px solid transparent"
      }}
    >
      {/* índice tipo pin de mapa */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 46,
          height: 46,
          borderRadius: 23,
          flexShrink: 0,
          backgroundColor: lead ? "#EA4335" : "#F1F3F4",
          color: lead ? "#FFFFFF" : "#5F6368",
          fontSize: 24,
          fontWeight: 700
        }}
      >
        {r.position ?? "·"}
      </div>

      {/* textos */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ display: "flex", fontSize: 32, fontWeight: 700, color: "#202124" }}>
          {`${clip(r.name, 22)}${lead ? "  ·  Tú" : ""}`}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 24, color: "#70757A" }}>
          <div style={{ display: "flex" }}>{r.rating != null ? r.rating.toFixed(1).replace(".", ",") : "—"}</div>
          <Stars rating={r.rating} />
          <div style={{ display: "flex" }}>{`(${r.reviewsCount ?? 0})`}</div>
        </div>
        <div style={{ display: "flex", marginTop: 4, fontSize: 22, color: "#70757A" }}>{sub}</div>
      </div>

      {/* miniatura (placeholder con inicial) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 96,
          height: 96,
          borderRadius: 12,
          flexShrink: 0,
          backgroundColor: "#E8EAED",
          color: "#9AA0A6",
          fontSize: 44,
          fontWeight: 700
        }}
      >
        {initial}
      </div>
    </div>
  );
}

export function buildRankingImage(data: CompetitorRanking): ImageResponse {
  const query = (data.query || `${data.category} ${data.locality}`).trim();
  const rows = data.rows.slice(0, 6);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#FFFFFF",
          padding: 40,
          fontFamily: "Inter"
        }}
      >
        {/* ── Cabecera: logo Google + barra de búsqueda ── */}
        <div style={{ display: "flex", marginBottom: 18 }}>
          {GOOGLE.map(([ch, color], i) => (
            <div key={i} style={{ display: "flex", fontSize: 46, fontWeight: 700, color }}>
              {ch}
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            backgroundColor: "#F1F3F4",
            borderRadius: 32,
            padding: "16px 26px",
            boxShadow: "0 1px 3px rgba(60,64,67,0.15)"
          }}
        >
          <div style={{ display: "flex", flex: 1, fontSize: 28, color: "#3C4043" }}>{clip(query, 34)}</div>
          {/* lupa */}
          <div style={{ display: "flex", position: "relative", width: 36, height: 36 }}>
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: 24,
                height: 24,
                borderRadius: 12,
                border: "4px solid #9AA0A6"
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 22,
                left: 22,
                width: 14,
                height: 4,
                borderRadius: 2,
                backgroundColor: "#9AA0A6",
                transform: "rotate(45deg)"
              }}
            />
          </div>
        </div>

        {/* pestañas */}
        <div style={{ display: "flex", gap: 30, marginTop: 18, fontSize: 24, color: "#5F6368" }}>
          <div style={{ display: "flex", color: "#1A73E8", fontWeight: 700 }}>Maps</div>
          <div style={{ display: "flex" }}>Imágenes</div>
          <div style={{ display: "flex" }}>Noticias</div>
          <div style={{ display: "flex" }}>Vídeos</div>
        </div>

        {/* ── Mini-mapa con pines numerados ── */}
        <div
          style={{
            display: "flex",
            position: "relative",
            height: 180,
            marginTop: 16,
            borderRadius: 14,
            backgroundColor: "#E5E8EB",
            overflow: "hidden"
          }}
        >
          {/* "carreteras" */}
          <div style={{ position: "absolute", top: 64, left: -60, width: 1300, height: 14, backgroundColor: "#FFFFFF", transform: "rotate(-7deg)" }} />
          <div style={{ position: "absolute", top: 122, left: -60, width: 1300, height: 10, backgroundColor: "#FFFFFF", transform: "rotate(5deg)" }} />
          <div style={{ position: "absolute", top: -30, left: 360, width: 12, height: 300, backgroundColor: "#FFFFFF", transform: "rotate(12deg)" }} />
          {/* zona verde (parque) */}
          <div style={{ position: "absolute", top: 96, left: 800, width: 260, height: 180, backgroundColor: "#CDE7D0" }} />
          {/* pines */}
          {rows.map((r, i) => {
            const [left, top] = PIN_POS[i] ?? [60 + i * 150, 60];
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left,
                  top,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: r.isLead ? 48 : 40,
                  height: r.isLead ? 48 : 40,
                  borderRadius: 24,
                  backgroundColor: r.isLead ? "#EA4335" : "#1A73E8",
                  color: "#FFFFFF",
                  fontSize: r.isLead ? 24 : 20,
                  fontWeight: 700,
                  border: "3px solid #FFFFFF",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.3)"
                }}
              >
                {r.position ?? i + 1}
              </div>
            );
          })}
        </div>

        {/* ── Lista de resultados ── */}
        <div style={{ display: "flex", marginTop: 18, marginBottom: 6, fontSize: 24, fontWeight: 700, color: "#5F6368" }}>
          Resultados
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            border: "1px solid #ECEDEF",
            borderRadius: 14,
            overflow: "hidden"
          }}
        >
          {rows.map((r, i) => (
            <Row key={i} r={r} category={data.category} locality={data.locality} />
          ))}
        </div>

        {/* pie discreto */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: 14, fontSize: 22, color: "#9AA0A6" }}>
          negociovivo.app
        </div>
      </div>
    ),
    { width: 1080, height: 1350, fonts: interFonts() }
  );
}

export async function renderRankingPng(data: CompetitorRanking): Promise<Buffer> {
  const img = buildRankingImage(data);
  const ab = await img.arrayBuffer();
  return Buffer.from(ab);
}
