/**
 * Tarjeta PNG del ranking de un lead, diseñada para PARECER UNA CAPTURA REAL de
 * los resultados de Google en un móvil Android (Chrome): barra de estado, barra
 * del navegador mostrando la KEYWORD buscada, chips de filtro, mini-mapa con
 * marcadores y atribución, y la lista de fichas "local pack" (estrellas, reseñas,
 * ⓘ, categoría) con botones SITIO WEB / LLAMAR. La ficha del negocio va resaltada
 * y marcada "· Tú". Si el lead está muy abajo (p. ej. #15) se muestran arriba sus
 * competidores y un SEPARADOR que evidencia la gran diferencia de posiciones.
 * Barra de navegación Android al pie. next/og (Satori).
 *
 * Nota: las fuentes solo traen pesos 400 y 700 (ver og-fonts). Sin emojis a color
 * (Satori no los cubre); "★" sí está en Inter. Los iconos se dibujan con divs.
 */
import { ImageResponse } from "next/og";
import { interFonts } from "./og-fonts";
import type { CompetitorRanking, RankingRow } from "./competitors";

const INK = "#202124";
const GREY = "#70757A";
const BLUE = "#1A73E8";
const RED = "#EA4335";

function clip(s: string, n = 30): string {
  const t = (s ?? "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function Stars({ rating }: { rating: number | null }) {
  const filled = Math.max(0, Math.min(5, Math.round(rating ?? 0)));
  return (
    <div style={{ display: "flex", fontSize: 22 }}>
      <div style={{ display: "flex", color: "#FBBC04" }}>{"★".repeat(filled)}</div>
      <div style={{ display: "flex", color: "#DADCE0" }}>{"★".repeat(5 - filled)}</div>
    </div>
  );
}

function GlobeIcon() {
  return (
    <div style={{ display: "flex", position: "relative", width: 34, height: 34 }}>
      <div style={{ position: "absolute", top: 0, left: 0, width: 34, height: 34, borderRadius: 17, border: `3px solid ${BLUE}` }} />
      <div style={{ position: "absolute", top: 0, left: 14, width: 3, height: 34, backgroundColor: BLUE }} />
      <div style={{ position: "absolute", top: 14, left: 0, width: 34, height: 3, backgroundColor: BLUE }} />
      <div style={{ position: "absolute", top: 6, left: 6, width: 22, height: 22, borderRadius: 11, border: `2px solid ${BLUE}` }} />
    </div>
  );
}

function PhoneIcon() {
  return (
    <div style={{ display: "flex", position: "relative", width: 34, height: 34 }}>
      <div style={{ position: "absolute", top: 4, left: 11, width: 14, height: 28, borderRadius: 7, backgroundColor: BLUE, transform: "rotate(135deg)" }} />
    </div>
  );
}

function ActionBtn({ icon, label }: { icon: any; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 130, gap: 6 }}>
      {icon}
      <div style={{ display: "flex", fontSize: 19, color: BLUE, fontWeight: 700 }}>{label}</div>
    </div>
  );
}

function InfoDot() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 12, border: `2px solid ${GREY}`, color: GREY, fontSize: 16 }}>
      i
    </div>
  );
}

// Marcador de mapa rojo (gota con punto blanco).
function MapPin({ left, top, size = 42 }: { left: number; top: number; size?: number }) {
  return (
    <div style={{ display: "flex", position: "absolute", left, top, width: size, height: size }}>
      <div style={{ position: "absolute", top: size * 0.46, left: size * 0.27, width: size * 0.46, height: size * 0.46, backgroundColor: RED, transform: "rotate(45deg)" }} />
      <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width: size, height: size, borderRadius: size / 2, backgroundColor: RED, border: "4px solid #FFFFFF", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }}>
        <div style={{ width: size * 0.26, height: size * 0.26, borderRadius: size * 0.13, backgroundColor: "#FFFFFF" }} />
      </div>
    </div>
  );
}

function RankBadge({ pos, lead }: { pos: number | string; lead: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 50,
        height: 50,
        borderRadius: 25,
        flexShrink: 0,
        backgroundColor: lead ? RED : "#F1F3F4",
        color: lead ? "#FFFFFF" : "#5F6368",
        fontSize: lead ? 24 : 22,
        fontWeight: 700
      }}
    >
      {pos}
    </div>
  );
}

function Row({ r, category, locality, showRank }: { r: RankingRow; category: string; locality: string; showRank: boolean }) {
  const lead = r.isLead;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "20px 18px",
        borderBottom: "1px solid #ECEDEF",
        backgroundColor: lead ? "#FCE8E6" : "#FFFFFF",
        borderLeft: lead ? `6px solid ${RED}` : "6px solid transparent"
      }}
    >
      {showRank ? <RankBadge pos={r.position ?? "20+"} lead={lead} /> : null}
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ display: "flex", fontSize: 31, fontWeight: 700, color: INK }}>
          {`${clip(r.name, 24)}${lead ? "  ·  Tú" : ""}`}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, fontSize: 23, color: GREY }}>
          <div style={{ display: "flex" }}>{r.rating != null ? r.rating.toFixed(1).replace(".", ",") : "—"}</div>
          <Stars rating={r.rating} />
          <div style={{ display: "flex" }}>{`(${r.reviewsCount ?? 0})`}</div>
          <InfoDot />
          <div style={{ display: "flex" }}>{`· ${clip(category, 14)}`}</div>
        </div>
        <div style={{ display: "flex", marginTop: 5, fontSize: 22, color: GREY }}>{clip(locality, 30)}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {r.website ? <ActionBtn icon={<GlobeIcon />} label="SITIO WEB" /> : null}
        {r.phone ? <ActionBtn icon={<PhoneIcon />} label="LLAMAR" /> : null}
      </div>
    </div>
  );
}

// Separador que evidencia la distancia de posiciones (lead muy por debajo).
function GapSeparator({ ahead }: { ahead: number | null }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "18px 0", backgroundColor: "#FFF4E5", borderTop: "1px solid #ECEDEF", borderBottom: "1px solid #ECEDEF" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#C8A95B" }} />
        <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#C8A95B" }} />
        <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#C8A95B" }} />
      </div>
      <div style={{ display: "flex", fontSize: 25, color: "#B45309", fontWeight: 700 }}>
        {ahead == null ? "No apareces en el top 20" : `${ahead} negocios por delante de ti`}
      </div>
    </div>
  );
}

function Map({ pins }: { pins: number }) {
  const pinPos: [number, number][] = [
    [430, 78],
    [520, 104],
    [605, 90],
    [360, 118],
    [665, 124]
  ];
  return (
    <div style={{ display: "flex", position: "relative", height: 230, backgroundColor: "#EAEEE7", overflow: "hidden" }}>
      {/* agua (con borde irregular por solape de rectángulos) */}
      <div style={{ position: "absolute", top: 40, left: 800, width: 420, height: 260, backgroundColor: "#A3CCF2" }} />
      <div style={{ position: "absolute", top: 120, left: 740, width: 200, height: 160, backgroundColor: "#A3CCF2", transform: "rotate(18deg)" }} />
      {/* parques */}
      <div style={{ position: "absolute", top: -30, left: -20, width: 250, height: 150, backgroundColor: "#C7E6B8" }} />
      <div style={{ position: "absolute", top: 150, left: 150, width: 200, height: 150, backgroundColor: "#D2EAC2" }} />
      {/* manzanas (bloques claros) */}
      <div style={{ position: "absolute", top: 30, left: 300, width: 120, height: 70, backgroundColor: "#F1F0EC" }} />
      <div style={{ position: "absolute", top: 130, left: 470, width: 140, height: 80, backgroundColor: "#F1F0EC" }} />
      <div style={{ position: "absolute", top: 20, left: 560, width: 110, height: 90, backgroundColor: "#F1F0EC" }} />
      {/* vías rápidas: casing blanco + amarillo encima */}
      <div style={{ position: "absolute", top: 100, left: -80, width: 1300, height: 18, backgroundColor: "#FFFFFF", transform: "rotate(-4deg)" }} />
      <div style={{ position: "absolute", top: 104, left: -80, width: 1300, height: 9, backgroundColor: "#F8CE46", transform: "rotate(-4deg)" }} />
      {/* calles secundarias */}
      <div style={{ position: "absolute", top: 165, left: -80, width: 1300, height: 8, backgroundColor: "#FFFFFF", transform: "rotate(3deg)" }} />
      <div style={{ position: "absolute", top: -30, left: 520, width: 8, height: 320, backgroundColor: "#FFFFFF", transform: "rotate(13deg)" }} />
      <div style={{ position: "absolute", top: -30, left: 250, width: 6, height: 320, backgroundColor: "#FFFFFF", transform: "rotate(-9deg)" }} />
      <div style={{ position: "absolute", top: -30, left: 760, width: 6, height: 320, backgroundColor: "#FFFFFF", transform: "rotate(8deg)" }} />
      {/* etiquetas */}
      <div style={{ display: "flex", position: "absolute", top: 168, left: 30, fontSize: 19, color: "#5F6368" }}>Tacoronte</div>
      <div style={{ display: "flex", position: "absolute", top: 56, left: 560, fontSize: 19, color: "#5F6368" }}>San Andrés</div>
      <div style={{ display: "flex", position: "absolute", top: 96, left: 70, backgroundColor: "#F4B400", color: "#FFFFFF", borderRadius: 5, padding: "2px 8px", fontSize: 16, fontWeight: 700 }}>TF-16</div>
      {/* marcadores */}
      {Array.from({ length: Math.min(pins, pinPos.length) }).map((_, i) => (
        <MapPin key={i} left={pinPos[i][0]} top={pinPos[i][1]} />
      ))}
      {/* expandir */}
      <div style={{ display: "flex", position: "absolute", top: 14, right: 14, width: 44, height: 44, borderRadius: 10, backgroundColor: "#FFFFFF", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
      {/* atribución */}
      <div style={{ display: "flex", position: "absolute", bottom: 6, right: 12, fontSize: 15, color: "#5F6368" }}>Datos del mapa ©2026 Google</div>
    </div>
  );
}

export function buildRankingImage(data: CompetitorRanking): ImageResponse {
  // La barra muestra la KEYWORD buscada (no la URL técnica).
  const keyword = `${data.category} ${data.locality}`.trim().toLowerCase();
  const rows = data.rows.slice(0, 5);
  // ¿El lead aparece muy abajo? → mostramos posiciones + separador del salto.
  const farDown = data.leadPosition == null || data.leadPosition > rows.length;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#FFFFFF", padding: "16px 0 0 0", fontFamily: "Inter" }}>
        {/* ── Barra de estado Android ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 28px 12px 28px" }}>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 700, color: INK }}>21:56</div>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3 }}>
              <div style={{ width: 5, height: 8, borderRadius: 1, backgroundColor: INK }} />
              <div style={{ width: 5, height: 12, borderRadius: 1, backgroundColor: INK }} />
              <div style={{ width: 5, height: 16, borderRadius: 1, backgroundColor: INK }} />
              <div style={{ width: 5, height: 20, borderRadius: 1, backgroundColor: INK }} />
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", width: 34, height: 18, borderRadius: 4, border: `2px solid ${INK}`, padding: 2 }}>
                <div style={{ width: 24, height: "100%", borderRadius: 1, backgroundColor: "#34A853" }} />
              </div>
              <div style={{ width: 3, height: 8, borderRadius: 1, marginLeft: 1, backgroundColor: INK }} />
            </div>
          </div>
        </div>

        {/* ── Barra del navegador con la KEYWORD ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "0 24px 14px 24px" }}>
          <div style={{ display: "flex", position: "relative", width: 30, height: 30 }}>
            <div style={{ position: "absolute", top: 0, left: 3, width: 0, height: 0, borderLeft: "12px solid transparent", borderRight: "12px solid transparent", borderBottom: `12px solid ${GREY}` }} />
            <div style={{ position: "absolute", top: 11, left: 6, width: 18, height: 15, backgroundColor: GREY }} />
          </div>
          <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 14, backgroundColor: "#F1F3F4", borderRadius: 26, padding: "12px 22px" }}>
            {/* lupa */}
            <div style={{ display: "flex", position: "relative", width: 26, height: 26 }}>
              <div style={{ position: "absolute", top: 0, left: 0, width: 18, height: 18, borderRadius: 9, border: `3px solid ${GREY}` }} />
              <div style={{ position: "absolute", top: 16, left: 16, width: 11, height: 3, borderRadius: 2, backgroundColor: GREY, transform: "rotate(45deg)" }} />
            </div>
            <div style={{ display: "flex", fontSize: 24, color: "#3C4043" }}>{clip(keyword, 40)}</div>
          </div>
          <div style={{ display: "flex", fontSize: 38, color: GREY }}>+</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 7, border: `2.5px solid ${GREY}`, fontSize: 19, fontWeight: 700, color: GREY }}>8</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: GREY }} />
            <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: GREY }} />
            <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: GREY }} />
          </div>
        </div>

        {/* ── Chips ── */}
        <div style={{ display: "flex", gap: 14, padding: "4px 24px 14px 24px" }}>
          <div style={{ display: "flex", border: "1px solid #DADCE0", borderRadius: 22, padding: "10px 22px", fontSize: 22, color: "#3C4043" }}>Abierto ahora</div>
          <div style={{ display: "flex", border: "1px solid #DADCE0", borderRadius: 22, padding: "10px 22px", fontSize: 22, color: "#3C4043" }}>Mejor valorados</div>
        </div>

        {/* ── Mapa ── */}
        <Map pins={rows.length} />

        {/* ── Lista ── */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          {rows.map((r, i) => {
            const gapBefore = farDown && r.isLead;
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column" }}>
                {gapBefore ? <GapSeparator ahead={data.aboveCount ?? null} /> : null}
                <Row r={r} category={data.category} locality={data.locality} showRank={farDown} />
              </div>
            );
          })}
        </div>

        {/* ── Barra de navegación Android ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around", padding: "16px 0", backgroundColor: "#FFFFFF" }}>
          <div style={{ width: 0, height: 0, borderTop: "13px solid transparent", borderBottom: "13px solid transparent", borderRight: `20px solid ${GREY}` }} />
          <div style={{ width: 26, height: 26, borderRadius: 13, border: `3px solid ${GREY}` }} />
          <div style={{ width: 24, height: 24, borderRadius: 5, border: `3px solid ${GREY}` }} />
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
