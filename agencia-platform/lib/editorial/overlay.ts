/**
 * Composición de overlays (logo + headlines) sobre la imagen base
 * generada por IA.
 *
 * Stack:
 *   - @resvg/resvg-js para renderizar el SVG → PNG con control explícito
 *     de fuentes (fontBuffers). Esto evita el problema de librsvg/sharp
 *     no encontrar @font-face data URLs en el contenedor de Railway.
 *   - sharp para componer el PNG resultante sobre la imagen base.
 *
 * Fuentes:
 *   - Si client.fonts tiene URLs (TTF/OTF/WOFF/WOFF2), las descarga server-side
 *     y las usa como fuente principal (igual que hacía el plugin).
 *   - Fallback: Inter WOFF2 commiteada en public/fonts/.
 *
 * Estilo:
 *   - SIN banda oscura de fondo: solo drop-shadow filter para legibilidad.
 *   - text_placement decide la zona (top/center/bottom).
 *   - Logo en la esquina configurada por el cliente.
 *   - Pattern "frame" añade franja diagonal Reva-style.
 */

import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";

export type OverlayPosition = "br" | "bl" | "tr" | "tl";

export type OverlayOpts = {
  imageUrl: string;
  logoUrl?: string | null;
  logoPosition?: OverlayPosition;
  headlines?: string[];
  primary?: string;
  accent?: string;
  text?: string;
  pattern?: "clean" | "frame";
};

export type HeadlineLine = {
  text: string;
  size: "sm" | "md" | "lg" | "xl";
  color: "white" | "accent" | "primary";
  weight: "regular" | "bold";
};

export type ClientFont = {
  url: string;
  name: string;
  weight: "regular" | "bold";
};

export type StructuredOverlayOpts = {
  baseBuffer: Buffer;
  headlines: HeadlineLine[];
  textPlacement: "top" | "center" | "bottom";
  logoUrl?: string | null;
  logoPosition?: OverlayPosition;
  primary?: string;
  accent?: string;
  text?: string;
  pattern?: "clean" | "frame";
  clientFonts?: ClientFont[];
};

// ---------- Carga de fuentes ----------
//
// resvg-js sólo acepta paths a archivos en disco (fontFiles / fontDirs),
// no buffers. Por eso descargamos a /tmp/agencia-hub-fonts/ y reusamos.

const FONT_DIR = join(tmpdir(), "agencia-hub-fonts");
function ensureFontDir() {
  try {
    if (!existsSync(FONT_DIR)) mkdirSync(FONT_DIR, { recursive: true });
  } catch {}
}

const FONT_PATH_CACHE = new Map<string, string>(); // url → local path

async function downloadFontToTmp(url: string): Promise<string | null> {
  if (FONT_PATH_CACHE.has(url)) {
    const p = FONT_PATH_CACHE.get(url)!;
    if (existsSync(p)) return p;
  }
  ensureFontDir();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    const buf = Buffer.from(ab);
    // Determinar extensión por content-type o URL
    const ct = (r.headers.get("content-type") ?? "").split(";")[0].trim();
    const ext =
      ct === "font/ttf" || url.endsWith(".ttf")
        ? "ttf"
        : ct === "font/otf" || url.endsWith(".otf")
          ? "otf"
          : ct === "font/woff" || url.endsWith(".woff")
            ? "woff"
            : "woff2";
    const hash = createHash("md5").update(url).digest("hex").slice(0, 12);
    const filePath = join(FONT_DIR, `${hash}.${ext}`);
    writeFileSync(filePath, buf);
    FONT_PATH_CACHE.set(url, filePath);
    return filePath;
  } catch {
    return null;
  }
}

function ensureInterFallback(): { regularPath: string | null; boldPath: string | null } {
  // Las fuentes commiteadas en public/fonts/ se leen directamente de
  // disco — no hace falta copiar a /tmp. Usamos TTF (no woff2) porque
  // el binario de @resvg/resvg-js distribuido no siempre incluye
  // soporte WOFF2.
  try {
    const root = process.cwd();
    const candidates = [
      join(root, "public", "fonts"),
      join(root, ".next", "standalone", "public", "fonts"),
      // Para dev en directorio de tests
      join(__dirname, "..", "..", "public", "fonts")
    ];
    let regularPath: string | null = null;
    let boldPath: string | null = null;
    for (const dir of candidates) {
      if (!regularPath && existsSync(join(dir, "Inter-Regular.ttf"))) {
        regularPath = join(dir, "Inter-Regular.ttf");
      }
      if (!boldPath && existsSync(join(dir, "Inter-Bold.ttf"))) {
        boldPath = join(dir, "Inter-Bold.ttf");
      }
      if (regularPath && boldPath) break;
    }
    if (process.env.DEBUG_OVERLAY_FONTS === "1") {
      console.log("[overlay] Inter paths:", { regularPath, boldPath, cwd: root });
    }
    return { regularPath, boldPath };
  } catch (e) {
    console.warn("[overlay] ensureInterFallback fallo:", (e as Error).message);
    return { regularPath: null, boldPath: null };
  }
}

async function resolveFontFamily(clientFonts?: ClientFont[]): Promise<{
  fontFiles: string[];
  fontFamily: string;
}> {
  if (clientFonts && clientFonts.length > 0) {
    const paths: string[] = [];
    for (const f of clientFonts) {
      const p = await downloadFontToTmp(f.url);
      if (p) paths.push(p);
    }
    if (paths.length > 0) {
      const family = clientFonts[0]?.name?.replace(/\..+$/, "") || "BrandFont";
      return { fontFiles: paths, fontFamily: family };
    }
  }
  // Fallback Inter
  const { regularPath, boldPath } = ensureInterFallback();
  const paths = [regularPath, boldPath].filter((p): p is string => p !== null);
  return { fontFiles: paths, fontFamily: "Inter" };
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo descargar ${url}: ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));
}

// ---------- Render SVG → PNG con resvg ----------

async function renderSvgToPng(svg: string, fontFiles: string[], width: number, _height: number, defaultFamily: string): Promise<Buffer> {
  if (process.env.DEBUG_OVERLAY_FONTS === "1") {
    console.log("[overlay] renderSvgToPng:", {
      fontFiles,
      defaultFamily,
      svgPreview: svg.slice(0, 500)
    });
  }
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: "rgba(0,0,0,0)",
    font: {
      fontFiles,
      // Fallback a fuentes del SO si las nuestras no funcionan (Railway
      // suele tener DejaVu Sans). El defaultFontFamily nos asegura que
      // si "Inter" no se encuentra, use la primera que cargamos.
      loadSystemFonts: true,
      defaultFontFamily: defaultFamily,
      sansSerifFamily: defaultFamily,
      serifFamily: defaultFamily
    }
  });
  const png = resvg.render().asPng();
  return Buffer.from(png);
}

// ---------- Overlay estructurado (uso principal) ----------

export async function composeOverlayStructured(opts: StructuredOverlayOpts): Promise<Buffer> {
  const meta = await sharp(opts.baseBuffer).metadata();
  const width = meta.width ?? 1080;
  const height = meta.height ?? 1080;

  const primary = opts.primary ?? "#1F2937";
  const accent = opts.accent ?? "#2563EB";
  const text = opts.text ?? "#FFFFFF";

  const padding = Math.round(width * 0.06);
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

  const lineHeights = lines.map((l) => sizePx(l.size));
  const gap = Math.round(height * 0.012);
  const totalH = lineHeights.reduce((a, b) => a + b, 0) + gap * (lines.length - 1);

  let y: number;
  if (opts.textPlacement === "top") {
    y = padding + Math.round(height * 0.04);
  } else if (opts.textPlacement === "center") {
    y = Math.round((height - totalH) / 2);
  } else {
    y = height - padding - totalH;
  }

  // Frame diagonal estilo "Reva" si pattern=frame
  const frameShape =
    opts.pattern === "frame"
      ? `<polygon points="0,0 ${width * 0.6},0 ${width * 0.4},${height * 0.32} 0,${height * 0.32}" fill="${primary}" fill-opacity="0.92"/>`
      : "";

  const { fontFiles, fontFamily } = await resolveFontFamily(opts.clientFonts);

  // Renderizar cada línea SIN banda. Drop-shadow filter para legibilidad
  // sobre cualquier fondo (claro u oscuro).
  // Cada línea se renderiza con texto + capa de sombra debajo. Sin
  // filter (algunas versiones de resvg no soportan feFlood/feMerge).
  // La sombra se hace con dos <text> idénticos: uno desplazado con
  // color rgba(0,0,0,0.65) y otro encima con el color real.
  const shadowOffset = Math.max(2, Math.round(height * 0.003));
  const lineEls = lines
    .map((l, i) => {
      const fs = lineHeights[i];
      const yLine = y + lineHeights.slice(0, i).reduce((a, b) => a + b, 0) + i * gap + fs * 0.82;
      const fill = colorHex(l.color);
      const fontWeight = l.weight === "bold" ? "700" : "400";
      const safeText = escapeXml(l.text);
      const xText = padding;
      return (
        `<text x="${xText + shadowOffset}" y="${yLine + shadowOffset}" fill="rgba(0,0,0,0.65)" font-family="${fontFamily}" font-weight="${fontWeight}" font-size="${fs}">${safeText}</text>` +
        `<text x="${xText}" y="${yLine}" fill="${fill}" font-family="${fontFamily}" font-weight="${fontWeight}" font-size="${fs}">${safeText}</text>`
      );
    })
    .join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${frameShape}
${lineEls}
</svg>`;

  const overlayPng = await renderSvgToPng(svg, fontFiles, width, height, fontFamily);

  const composites: sharp.OverlayOptions[] = [{ input: overlayPng, top: 0, left: 0 }];

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
      let logoTop = pos.startsWith("t") ? margin : height - lh - margin;
      const logoLeft = pos.endsWith("r") ? width - lw - margin : margin;
      // Evita solapar con el texto si caen en la misma mitad
      if (opts.textPlacement === "top" && pos.startsWith("t")) {
        logoTop = height - lh - margin;
      }
      if (opts.textPlacement === "bottom" && !pos.startsWith("t")) {
        logoTop = margin;
      }
      composites.push({ input: resizedLogo, top: logoTop, left: logoLeft });
    } catch {}
  }

  return await sharp(opts.baseBuffer).composite(composites).png().toBuffer();
}

// ---------- Versión legacy (compat con re-apply overlay endpoint) ----------

export async function composeOverlay(opts: OverlayOpts): Promise<Buffer> {
  const baseBuf = await fetchBuffer(opts.imageUrl);
  // Convertir lista plana de strings a HeadlineLine para reusar el motor estructurado
  const lines = (opts.headlines ?? []).filter(Boolean);
  const headlines: HeadlineLine[] = lines.map((t, i) => ({
    text: t,
    size: i === 0 ? "xl" : "md",
    color: i === 0 ? "white" : "accent",
    weight: i === 0 ? "bold" : "regular"
  }));
  return composeOverlayStructured({
    baseBuffer: baseBuf,
    headlines,
    textPlacement: "bottom",
    logoUrl: opts.logoUrl,
    logoPosition: opts.logoPosition,
    primary: opts.primary,
    accent: opts.accent,
    text: opts.text,
    pattern: opts.pattern
  });
}
