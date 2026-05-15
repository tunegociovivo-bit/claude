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
