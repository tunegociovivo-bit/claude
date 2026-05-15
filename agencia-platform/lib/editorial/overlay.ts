/**
 * Composición servidor-side de overlays (logo + headlines) sobre una
 * imagen generada por IA. Usa sharp para componer + SVG inline para
 * renderizar texto con la fuente del cliente cuando esté disponible.
 *
 * No regenera con OpenAI; solo recomposita píxeles. Migra
 * "reaplicar-overlay" del plugin.
 */

import sharp from "sharp";

export type OverlayPosition = "br" | "bl" | "tr" | "tl";

export type OverlayOpts = {
  imageUrl: string;
  logoUrl?: string | null;
  logoPosition?: OverlayPosition;
  headlines?: string[]; // 1-3 líneas (la primera grande)
  // colores brand
  primary?: string;
  accent?: string;
  text?: string;
  // patrón visual
  pattern?: "clean" | "frame";
};

async function fetchBuffer(url: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo descargar ${url}: ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));
}

/**
 * SVG con las headlines del cliente. Tipografía: Inter (web safe).
 * Si hay pattern="frame", añadimos una franja diagonal de color brand.
 */
function buildOverlaySvg(width: number, height: number, opts: OverlayOpts): string {
  const lines = (opts.headlines ?? []).filter((s) => s && s.trim()).slice(0, 3);
  const primary = opts.primary ?? "#1F2937";
  const accent = opts.accent ?? "#2563EB";
  const text = opts.text ?? "#FFFFFF";
  const padding = Math.round(width * 0.06);
  const lineHeight = Math.round(height * 0.07);
  const fontSize0 = Math.round(height * 0.075);
  const fontSize1 = Math.round(height * 0.045);

  // Franja diagonal "frame"
  const frame =
    opts.pattern === "frame"
      ? `<polygon points="0,0 ${width * 0.6},0 ${width * 0.4},${height * 0.3} 0,${height * 0.3}" fill="${primary}" fill-opacity="0.92"/>`
      : "";

  // Encadenamos texto: primera línea grande, resto pequeñas
  const baseY = opts.pattern === "frame" ? Math.round(height * 0.15) : height - padding - lineHeight * lines.length;
  const lineEls = lines
    .map((line, i) => {
      const size = i === 0 ? fontSize0 : fontSize1;
      const color = i === 0 ? (opts.pattern === "frame" ? text : text) : accent;
      const y = baseY + i * lineHeight + size * 0.8;
      return `<text x="${padding}" y="${y}" fill="${color}" font-family="Inter, system-ui, sans-serif" font-weight="${i === 0 ? "800" : "500"}" font-size="${size}" style="paint-order: stroke; stroke: rgba(0,0,0,0.35); stroke-width: ${Math.round(size * 0.06)}px;">${escapeXml(line)}</text>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${frame}
${lineEls}
</svg>`;
}

export type HeadlineLine = {
  text: string;
  size: "sm" | "md" | "lg" | "xl";
  color: "white" | "accent" | "primary";
  weight: "regular" | "bold";
};

export type StructuredOverlayOpts = {
  // Buffer directo (no URL — usado por generate-image tras llamada IA)
  baseBuffer: Buffer;
  headlines: HeadlineLine[];
  textPlacement: "top" | "center" | "bottom";
  logoUrl?: string | null;
  logoPosition?: OverlayPosition;
  primary?: string;
  accent?: string;
  text?: string;
  pattern?: "clean" | "frame";
};

/**
 * Versión "rica" del overlay que entiende headline_lines estructuradas
 * (size + color + weight por línea) y text_placement (top/center/bottom).
 * Usada por generate-image.ts tras llamada a gpt-image-1.
 */
export async function composeOverlayStructured(opts: StructuredOverlayOpts): Promise<Buffer> {
  const meta = await sharp(opts.baseBuffer).metadata();
  const width = meta.width ?? 1080;
  const height = meta.height ?? 1080;

  const primary = opts.primary ?? "#1F2937";
  const accent = opts.accent ?? "#2563EB";
  const text = opts.text ?? "#FFFFFF";

  const padding = Math.round(width * 0.06);
  // Tamaño en px relativo al alto de la imagen
  const sizePx = (s: HeadlineLine["size"]): number => {
    switch (s) {
      case "xl":
        return Math.round(height * 0.085);
      case "lg":
        return Math.round(height * 0.065);
      case "md":
        return Math.round(height * 0.048);
      case "sm":
      default:
        return Math.round(height * 0.035);
    }
  };
  const colorHex = (c: HeadlineLine["color"]): string => {
    if (c === "accent") return accent;
    if (c === "primary") return primary;
    return text;
  };

  const lines = opts.headlines.filter((h) => h?.text?.trim()).slice(0, 6);
  if (lines.length === 0) return opts.baseBuffer;

  // Calculamos altura total del bloque de texto
  const lineHeights = lines.map((l) => sizePx(l.size));
  const gap = Math.round(height * 0.012);
  const totalH = lineHeights.reduce((a, b) => a + b, 0) + gap * (lines.length - 1);

  // Posición vertical inicial según placement
  let y: number;
  if (opts.textPlacement === "top") {
    y = padding;
  } else if (opts.textPlacement === "center") {
    y = Math.round((height - totalH) / 2);
  } else {
    y = height - padding - totalH;
  }

  // Banda semitransparente debajo del texto para asegurar legibilidad
  // sobre fotos con áreas claras (sólo si pattern != "frame" que ya
  // tiene su propio bloque de color).
  let bandShape = "";
  if (opts.pattern !== "frame") {
    const bandY = Math.max(0, y - padding * 0.5);
    const bandH = Math.min(height - bandY, totalH + padding);
    // Color de la banda en función de los colores de las líneas: si la
    // mayoría son blancas, banda oscura; si son accent/primary, blanca.
    const whiteCount = lines.filter((l) => l.color === "white").length;
    const bandFill = whiteCount >= lines.length / 2 ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.85)";
    bandShape = `<rect x="0" y="${bandY}" width="${width}" height="${bandH}" fill="${bandFill}"/>`;
  }

  // Frame diagonal estilo "Reva" (sólo si pattern=frame)
  const frameShape =
    opts.pattern === "frame"
      ? `<polygon points="0,0 ${width * 0.6},0 ${width * 0.4},${height * 0.32} 0,${height * 0.32}" fill="${primary}" fill-opacity="0.92"/>`
      : "";

  // Renderizar cada línea
  const lineEls = lines
    .map((l, i) => {
      const fs = lineHeights[i];
      const yLine = y + lineHeights.slice(0, i).reduce((a, b) => a + b, 0) + i * gap + fs * 0.82;
      const fill = colorHex(l.color);
      const fontWeight = l.weight === "bold" ? "800" : "500";
      return `<text x="${padding}" y="${yLine}" fill="${fill}" font-family="Inter, system-ui, -apple-system, sans-serif" font-weight="${fontWeight}" font-size="${fs}" style="paint-order: stroke; stroke: rgba(0,0,0,0.25); stroke-width: ${Math.round(fs * 0.04)}px;">${escapeXml(l.text)}</text>`;
    })
    .join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${frameShape}
${bandShape}
${lineEls}
</svg>`;

  const composites: sharp.OverlayOptions[] = [{ input: Buffer.from(svg), top: 0, left: 0 }];

  // Logo
  if (opts.logoUrl) {
    try {
      const logoBuf = await fetchBuffer(opts.logoUrl);
      const targetW = Math.round(width * 0.16);
      const resizedLogo = await sharp(logoBuf).resize({ width: targetW, withoutEnlargement: false }).png().toBuffer();
      const lm = await sharp(resizedLogo).metadata();
      const lw = lm.width ?? targetW;
      const lh = lm.height ?? targetW;
      const margin = Math.round(width * 0.04);
      const pos = opts.logoPosition ?? "br";
      // Evitar que el logo solape con el texto si están en el mismo lado
      let logoTop = pos.startsWith("t") ? margin : height - lh - margin;
      const logoLeft = pos.endsWith("r") ? width - lw - margin : margin;
      // Si placement=top y el logo está arriba, lo movemos abajo
      if (opts.textPlacement === "top" && pos.startsWith("t")) {
        logoTop = height - lh - margin;
      }
      // Si placement=bottom y el logo está abajo, lo movemos arriba
      if (opts.textPlacement === "bottom" && !pos.startsWith("t")) {
        logoTop = margin;
      }
      composites.push({ input: resizedLogo, top: logoTop, left: logoLeft });
    } catch {
      // logo opcional
    }
  }

  return await sharp(opts.baseBuffer).composite(composites).png().toBuffer();
}

/**
 * Compone la imagen final (PNG buffer) con overlay aplicado.
 */
export async function composeOverlay(opts: OverlayOpts): Promise<Buffer> {
  const baseBuf = await fetchBuffer(opts.imageUrl);
  const meta = await sharp(baseBuf).metadata();
  const width = meta.width ?? 1080;
  const height = meta.height ?? 1080;

  let img = sharp(baseBuf);
  const composites: sharp.OverlayOptions[] = [];

  // 1) Headlines via SVG
  if (opts.headlines && opts.headlines.length > 0) {
    const svg = buildOverlaySvg(width, height, opts);
    composites.push({ input: Buffer.from(svg), top: 0, left: 0 });
  }

  // 2) Logo
  if (opts.logoUrl) {
    try {
      const logoBuf = await fetchBuffer(opts.logoUrl);
      const targetW = Math.round(width * 0.18);
      const resizedLogo = await sharp(logoBuf).resize({ width: targetW, withoutEnlargement: false }).png().toBuffer();
      const logoMeta = await sharp(resizedLogo).metadata();
      const lw = logoMeta.width ?? targetW;
      const lh = logoMeta.height ?? targetW;
      const margin = Math.round(width * 0.04);
      const pos = opts.logoPosition ?? "br";
      const top = pos.startsWith("t") ? margin : height - lh - margin;
      const left = pos.endsWith("r") ? width - lw - margin : margin;
      composites.push({ input: resizedLogo, top, left });
    } catch {
      // logo opcional; ignorar fallo
    }
  }

  if (composites.length > 0) img = img.composite(composites);

  return await img.png().toBuffer();
}
