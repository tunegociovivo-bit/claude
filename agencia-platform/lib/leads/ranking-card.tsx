/**
 * Tarjeta PNG del ranking de un lead, diseñada para PARECER UNA CAPTURA REAL de
 * los resultados de Google en un móvil Android (Chrome): barra de estado, barra
 * del navegador con "google.com/search?q=…", chips de filtro, mini-mapa con
 * marcadores rojos + atribución, y la lista de fichas "local pack" (estrellas
 * doradas, reseñas, ⓘ, categoría) con botones SITIO WEB / LLAMAR. La ficha del
 * negocio va resaltada y marcada "· Tú". Barra de navegación Android al pie.
 * next/og (Satori).
 *
 * Nota: las fuentes solo traen pesos 400 y 700 (ver og-fonts), así que NO se
 * usan otros pesos. Sin emojis a color (Satori no los cubre sin fuente extra);
 * "★" sí está en Inter. Los iconos se dibujan con divs.
 */
import { ImageResponse } from "next/og";
import { interFonts } from "./og-fonts";
import type { CompetitorRanking, RankingRow } from "./competitors";

const INK = "#202124";
const GREY = "#70757A";
const BLUE = "#1A73E8";

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

// Globo del botón "SITIO WEB" (círculo con meridianos).
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

// Auricular del botón "LLAMAR" (barra redondeada en diagonal).
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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: 12,
        border: `2px solid ${GREY}`,
        color: GREY,
        fontSize: 16
      }}
    >
      i
    </div>
  );
}

function Row({ r, category, locality }: { r: RankingRow; category: string; locality: string }) {
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
        borderLeft: lead ? "6px solid #EA4335" : "6px solid transparent"
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ display: "flex", fontSize: 31, fontWeight: 700, color: INK }}>
          {`${clip(r.name, 26)}${lead ? "  ·  Tú" : ""}`}
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

      {/* acciones a la derecha: SITIO WEB / LLAMAR (solo si la ficha lo tiene) */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {r.website ? <ActionBtn icon={<GlobeIcon />} label="SITIO WEB" /> : null}
        {r.phone ? <ActionBtn icon={<PhoneIcon />} label="LLAMAR" /> : null}
      </div>
    </div>
  );
}

export function buildRankingImage(data: CompetitorRanking): ImageResponse {
  const q = (data.query || `${data.category} ${data.locality}`).trim();
  const url = `google.com/search?q=${clip(q.replace(/\s+/g, "+"), 22)}`;
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
          padding: "16px 0 0 0",
          fontFamily: "Inter"
        }}
      >
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
            {/* batería */}
            <div style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", width: 34, height: 18, borderRadius: 4, border: `2px solid ${INK}`, padding: 2 }}>
                <div style={{ width: 24, height: "100%", borderRadius: 1, backgroundColor: "#34A853" }} />
              </div>
              <div style={{ width: 3, height: 8, borderRadius: 1, marginLeft: 1, backgroundColor: INK }} />
            </div>
          </div>
        </div>

        {/* ── Barra del navegador (Chrome) ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "0 24px 14px 24px" }}>
          {/* casa */}
          <div style={{ display: "flex", position: "relative", width: 30, height: 30 }}>
            <div style={{ position: "absolute", top: 0, left: 3, width: 0, height: 0, borderLeft: "12px solid transparent", borderRight: "12px solid transparent", borderBottom: `12px solid ${GREY}` }} />
            <div style={{ position: "absolute", top: 11, left: 6, width: 18, height: 15, backgroundColor: GREY }} />
          </div>
          {/* pill url */}
          <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 12, backgroundColor: "#F1F3F4", borderRadius: 26, padding: "12px 22px" }}>
            {/* candado */}
            <div style={{ display: "flex", position: "relative", width: 18, height: 22 }}>
              <div style={{ position: "absolute", top: 0, left: 3, width: 12, height: 12, borderRadius: 6, border: `3px solid ${GREY}` }} />
              <div style={{ position: "absolute", bottom: 0, left: 0, width: 18, height: 13, borderRadius: 3, backgroundColor: GREY }} />
            </div>
            <div style={{ display: "flex", fontSize: 25, color: "#3C4043" }}>{url}</div>
          </div>
          {/* + */}
          <div style={{ display: "flex", fontSize: 38, color: GREY }}>+</div>
          {/* contador de pestañas */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 7, border: `2.5px solid ${GREY}`, fontSize: 19, fontWeight: 700, color: GREY }}>
            8
          </div>
          {/* menú */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: GREY }} />
            <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: GREY }} />
            <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: GREY }} />
          </div>
        </div>

        {/* ── Chips de filtro ── */}
        <div style={{ display: "flex", gap: 14, padding: "4px 24px 14px 24px" }}>
          <div style={{ display: "flex", border: "1px solid #DADCE0", borderRadius: 22, padding: "10px 22px", fontSize: 22, color: "#3C4043" }}>Abierto ahora</div>
          <div style={{ display: "flex", border: "1px solid #DADCE0", borderRadius: 22, padding: "10px 22px", fontSize: 22, color: "#3C4043" }}>Mejor valorados</div>
        </div>

        {/* ── Mini-mapa ── */}
        <div style={{ display: "flex", position: "relative", height: 210, backgroundColor: "#E8EAED", overflow: "hidden" }}>
          {/* agua */}
          <div style={{ position: "absolute", top: 70, left: 760, width: 420, height: 220, backgroundColor: "#A9D1F5" }} />
          {/* terreno verde */}
          <div style={{ position: "absolute", top: -30, left: -20, width: 280, height: 150, backgroundColor: "#CBE8C3" }} />
          <div style={{ position: "absolute", top: 120, left: 120, width: 220, height: 160, backgroundColor: "#D9ECCB" }} />
          {/* calles */}
          <div style={{ position: "absolute", top: 96, left: -60, width: 1300, height: 9, backgroundColor: "#FFFFFF", transform: "rotate(-4deg)" }} />
          <div style={{ position: "absolute", top: 150, left: -60, width: 1300, height: 7, backgroundColor: "#FFFFFF", transform: "rotate(3deg)" }} />
          <div style={{ position: "absolute", top: -30, left: 520, width: 8, height: 320, backgroundColor: "#FFFFFF", transform: "rotate(14deg)" }} />
          {/* etiquetas de zona */}
          <div style={{ display: "flex", position: "absolute", top: 150, left: 30, fontSize: 19, color: "#5F6368" }}>Tacoronte</div>
          <div style={{ display: "flex", position: "absolute", top: 60, left: 560, fontSize: 19, color: "#5F6368" }}>San Andrés</div>
          <div style={{ display: "flex", position: "absolute", top: 92, left: 60, backgroundColor: "#F4B400", color: "#FFFFFF", borderRadius: 5, padding: "2px 8px", fontSize: 16, fontWeight: 700 }}>TF-16</div>
          {/* marcadores rojos (clúster central) */}
          {[
            [430, 70],
            [520, 96],
            [600, 84]
          ].map(([l, t], i) => (
            <div key={i} style={{ display: "flex", position: "absolute", left: l, top: t, width: 44, height: 44, borderRadius: 22, backgroundColor: "#EA4335", border: "4px solid #FFFFFF", boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }} />
          ))}
          {/* botón expandir */}
          <div style={{ display: "flex", position: "absolute", top: 14, right: 14, width: 44, height: 44, borderRadius: 22, backgroundColor: "#FFFFFF", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
          {/* atribución */}
          <div style={{ display: "flex", position: "absolute", bottom: 6, right: 12, fontSize: 15, color: "#5F6368" }}>Datos del mapa ©2026 Google</div>
        </div>

        {/* ── Lista de resultados (local pack) ── */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          {rows.map((r, i) => (
            <Row key={i} r={r} category={data.category} locality={data.locality} />
          ))}
        </div>

        {/* ── Barra de navegación Android ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around", padding: "16px 0", backgroundColor: "#FFFFFF" }}>
          {/* atrás (triángulo) */}
          <div style={{ width: 0, height: 0, borderTop: "13px solid transparent", borderBottom: "13px solid transparent", borderRight: `20px solid ${GREY}` }} />
          {/* inicio (círculo) */}
          <div style={{ width: 26, height: 26, borderRadius: 13, border: `3px solid ${GREY}` }} />
          {/* recientes (cuadrado) */}
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
