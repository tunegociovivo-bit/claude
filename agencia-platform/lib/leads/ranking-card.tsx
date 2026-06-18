/**
 * Tarjeta PNG del ranking de un lead, diseñada para PARECER UNA CAPTURA REAL
 * de los resultados de Google en un móvil: barra de estado (hora/cobertura/
 * batería), logo Google, barra de búsqueda con la consulta, pestañas, mini-mapa
 * con pines en forma de gota y la lista de fichas estilo "local pack" (estrellas
 * doradas, reseñas, categoría) + botón "Más lugares". La ficha del negocio va
 * resaltada y marcada "· Tú". next/og (Satori).
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
  [150, 28],
  [470, 70],
  [720, 24],
  [880, 92],
  [330, 96],
  [600, 110]
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

// Pin tipo "gota" de Google Maps: círculo con cola triangular y nº dentro.
function Pin({ n, lead, left, top }: { n: number | string; lead: boolean; left: number; top: number }) {
  const color = lead ? "#EA4335" : "#4285F4";
  const d = lead ? 40 : 34;
  return (
    <div style={{ display: "flex", position: "absolute", left, top, width: d, height: d }}>
      {/* cola */}
      <div
        style={{
          position: "absolute",
          top: d * 0.5,
          left: d * 0.27,
          width: d * 0.46,
          height: d * 0.46,
          backgroundColor: color,
          transform: "rotate(45deg)"
        }}
      />
      {/* cabeza */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: d,
          height: d,
          borderRadius: d / 2,
          backgroundColor: color,
          border: "3px solid #FFFFFF",
          color: "#FFFFFF",
          fontSize: lead ? 22 : 18,
          fontWeight: 700,
          boxShadow: "0 1px 4px rgba(0,0,0,0.3)"
        }}
      >
        {n}
      </div>
    </div>
  );
}

function Row({ r, category, locality }: { r: RankingRow; category: string; locality: string }) {
  const lead = r.isLead;
  const initial = (r.name || "?").trim().charAt(0).toUpperCase();
  const sub = [clip(category, 16), clip(locality, 16)].filter(Boolean).join(" · ");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "20px 18px",
        borderBottom: "1px solid #ECEDEF",
        backgroundColor: lead ? "#FCE8E6" : "#FFFFFF",
        borderLeft: lead ? "6px solid #EA4335" : "6px solid transparent"
      }}
    >
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

      {/* miniatura: foto real de Google si la hay, si no la inicial */}
      {r.photoDataUrl ? (
        <img
          src={r.photoDataUrl}
          width={96}
          height={96}
          style={{ width: 96, height: 96, borderRadius: 12, objectFit: "cover", flexShrink: 0 }}
        />
      ) : (
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
      )}
    </div>
  );
}

export function buildRankingImage(data: CompetitorRanking): ImageResponse {
  const query = (data.query || `${data.category} ${data.locality}`).trim();
  const rows = data.rows.slice(0, 5);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#FFFFFF",
          padding: "20px 34px 30px 34px",
          fontFamily: "Inter"
        }}
      >
        {/* ── Barra de estado del móvil ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: "#202124" }}>9:41</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* cobertura */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3 }}>
              <div style={{ width: 5, height: 8, borderRadius: 1, backgroundColor: "#202124" }} />
              <div style={{ width: 5, height: 12, borderRadius: 1, backgroundColor: "#202124" }} />
              <div style={{ width: 5, height: 16, borderRadius: 1, backgroundColor: "#202124" }} />
              <div style={{ width: 5, height: 20, borderRadius: 1, backgroundColor: "#202124" }} />
            </div>
            <div style={{ display: "flex", fontSize: 20, color: "#202124" }}>5G</div>
            {/* batería */}
            <div style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", width: 34, height: 18, borderRadius: 4, border: "2px solid #202124", padding: 2 }}>
                <div style={{ width: 20, height: "100%", borderRadius: 1, backgroundColor: "#202124" }} />
              </div>
              <div style={{ width: 3, height: 8, borderRadius: 1, marginLeft: 1, backgroundColor: "#202124" }} />
            </div>
          </div>
        </div>

        {/* ── Logo Google + barra de búsqueda ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex" }}>
            {GOOGLE.map(([ch, color], i) => (
              <div key={i} style={{ display: "flex", fontSize: 42, fontWeight: 700, color }}>
                {ch}
              </div>
            ))}
          </div>
          {/* avatar de perfil */}
          <div style={{ display: "flex", width: 44, height: 44, borderRadius: 22, backgroundColor: "#C6DAFC" }} />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            backgroundColor: "#FFFFFF",
            border: "1px solid #DFE1E5",
            borderRadius: 32,
            padding: "14px 24px",
            boxShadow: "0 1px 4px rgba(60,64,67,0.12)"
          }}
        >
          <div style={{ display: "flex", flex: 1, fontSize: 28, color: "#3C4043" }}>{clip(query, 30)}</div>
          {/* micro (dos tonos) + lupa */}
          <div style={{ display: "flex", width: 20, height: 28, borderRadius: 10, backgroundColor: "#4285F4", marginRight: 16 }} />
          <div style={{ display: "flex", position: "relative", width: 34, height: 34 }}>
            <div style={{ position: "absolute", top: 0, left: 0, width: 22, height: 22, borderRadius: 11, border: "4px solid #9AA0A6" }} />
            <div style={{ position: "absolute", top: 20, left: 20, width: 13, height: 4, borderRadius: 2, backgroundColor: "#9AA0A6", transform: "rotate(45deg)" }} />
          </div>
        </div>

        {/* pestañas con "Todo" activa */}
        <div style={{ display: "flex", gap: 30, marginTop: 18, paddingBottom: 12, borderBottom: "1px solid #EBEDEF", fontSize: 24, color: "#5F6368" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "#1A73E8", fontWeight: 700 }}>
            Todo
          </div>
          <div style={{ display: "flex" }}>Imágenes</div>
          <div style={{ display: "flex" }}>Maps</div>
          <div style={{ display: "flex" }}>Noticias</div>
          <div style={{ display: "flex" }}>Vídeos</div>
        </div>

        {/* ── Mini-mapa con pines en forma de gota ── */}
        <div
          style={{
            display: "flex",
            position: "relative",
            height: 180,
            marginTop: 16,
            borderRadius: 14,
            backgroundColor: "#E8EAED",
            overflow: "hidden"
          }}
        >
          {/* agua */}
          <div style={{ position: "absolute", top: 110, left: 720, width: 360, height: 200, backgroundColor: "#A9D1F5" }} />
          {/* parque */}
          <div style={{ position: "absolute", top: -20, left: 40, width: 180, height: 150, backgroundColor: "#C8E6C9" }} />
          {/* calles finas */}
          <div style={{ position: "absolute", top: 70, left: -60, width: 1300, height: 9, backgroundColor: "#FFFFFF", transform: "rotate(-5deg)" }} />
          <div style={{ position: "absolute", top: 126, left: -60, width: 1300, height: 7, backgroundColor: "#FFFFFF", transform: "rotate(4deg)" }} />
          <div style={{ position: "absolute", top: -30, left: 420, width: 8, height: 300, backgroundColor: "#FFFFFF", transform: "rotate(10deg)" }} />
          <div style={{ position: "absolute", top: -30, left: 760, width: 7, height: 300, backgroundColor: "#FFFFFF", transform: "rotate(-12deg)" }} />
          {/* pines */}
          {rows.map((r, i) => {
            const [left, top] = PIN_POS[i] ?? [80 + i * 150, 60];
            return <Pin key={i} n={r.position ?? i + 1} lead={r.isLead} left={left} top={top} />;
          })}
          {/* etiqueta "Ver mapa más grande" */}
          <div
            style={{
              display: "flex",
              position: "absolute",
              bottom: 12,
              left: 12,
              backgroundColor: "#FFFFFF",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 18,
              color: "#1A73E8",
              boxShadow: "0 1px 3px rgba(0,0,0,0.2)"
            }}
          >
            Ver mapa más grande
          </div>
        </div>

        {/* ── Lista de resultados (local pack) ── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            marginTop: 16,
            border: "1px solid #ECEDEF",
            borderRadius: 14,
            overflow: "hidden"
          }}
        >
          {rows.map((r, i) => (
            <Row key={i} r={r} category={data.category} locality={data.locality} />
          ))}
          {/* botón "Más lugares" */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 0", fontSize: 26, color: "#1A73E8", fontWeight: 700 }}>
            Más lugares
          </div>
        </div>

        {/* pie discreto */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: 14, fontSize: 22, color: "#BDC1C6" }}>
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
