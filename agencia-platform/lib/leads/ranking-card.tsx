/**
 * Tarjeta PNG "tú vs tu competencia en Google" para un lead: lista de
 * posiciones en Google (competidores por delante + el negocio resaltado) para
 * que vea de un vistazo que la competencia está por encima. next/og (Satori).
 */
import { ImageResponse } from "next/og";
import type { CompetitorRanking, RankingRow } from "./competitors";

function clip(s: string, n = 26): string {
  const t = (s ?? "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function Row({ r }: { r: RankingRow }) {
  const lead = r.isLead;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: 18,
        borderRadius: 14,
        backgroundColor: lead ? "#7f1d1d" : "#ffffff",
        border: lead ? "3px solid #ef4444" : "1px solid #e5e7eb"
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 64,
          height: 64,
          borderRadius: 12,
          backgroundColor: lead ? "#ef4444" : "#0f172a",
          color: "#ffffff",
          fontSize: 28,
          fontWeight: 800
        }}
      >
        {r.position ? `#${r.position}` : "+20"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ fontSize: 30, fontWeight: 800, color: lead ? "#ffffff" : "#111827" }}>
          {clip(r.name)}
          {lead ? "  (TÚ)" : ""}
        </div>
        <div style={{ fontSize: 23, color: lead ? "#fecaca" : "#6b7280", marginTop: 2 }}>
          ★ {r.rating != null ? r.rating.toFixed(1) : "—"} · {r.reviewsCount} reseñas
        </div>
      </div>
    </div>
  );
}

export function buildRankingImage(data: CompetitorRanking): ImageResponse {
  const title = `${clip(data.category, 22)}${data.locality ? ` · ${clip(data.locality, 18)}` : ""}`;
  const band =
    data.leadPosition === 1
      ? "¡Estás en el #1 de Google! 🏆"
      : data.leadPosition
        ? `Estás en la posición #${data.leadPosition} — ${data.aboveCount} competidor${data.aboveCount === 1 ? "" : "es"} por delante`
        : `No apareces en el top 20 — tus competidores se llevan las llamadas`;

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
        <div style={{ display: "flex", flexDirection: "column", marginBottom: 18 }}>
          <div style={{ fontSize: 30, color: "#94a3b8" }}>📍 Posición en Google</div>
          <div style={{ fontSize: 46, fontWeight: 800, color: "#ffffff" }}>{title}</div>
        </div>

        <div
          style={{
            display: "flex",
            backgroundColor: "#ef4444",
            color: "#ffffff",
            borderRadius: 12,
            padding: "14px 20px",
            fontSize: 28,
            fontWeight: 700,
            marginBottom: 18
          }}
        >
          {band}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
          {data.rows.map((r, i) => (
            <Row key={i} r={r} />
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: 20,
            fontSize: 26,
            fontWeight: 700,
            color: "#ffffff"
          }}
        >
          negociovivo.app · Te subimos al top de Google
        </div>
      </div>
    ),
    { width: 1080, height: 1080 }
  );
}

export async function renderRankingPng(data: CompetitorRanking): Promise<Buffer> {
  const img = buildRankingImage(data);
  const ab = await img.arrayBuffer();
  return Buffer.from(ab);
}
