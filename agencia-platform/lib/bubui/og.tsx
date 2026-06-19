/**
 * Imagen Open Graph de marca para las páginas del directorio Bubui.
 * Se usa desde los archivos opengraph-image.tsx de cada ruta.
 */
import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

/** Capitaliza un slug de localidad: "benalmadena" → "Benalmádena" (aprox.). */
export function deslug(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function ogImage(title: string, subtitle: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: "linear-gradient(135deg, #EC4899 0%, #C026D3 100%)",
          color: "white",
          fontFamily: "sans-serif"
        }}
      >
        <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: -1 }}>bubui</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 72, fontWeight: 900, lineHeight: 1.05 }}>{title}</div>
          <div style={{ fontSize: 34, marginTop: 20, opacity: 0.92 }}>{subtitle}</div>
        </div>
        <div style={{ fontSize: 28, opacity: 0.9 }}>Directorio de negocios locales con descuentos</div>
      </div>
    ),
    { ...OG_SIZE }
  );
}
