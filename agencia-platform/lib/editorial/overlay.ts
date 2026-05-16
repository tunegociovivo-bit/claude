/**
 * Composición de overlays sobre imágenes generadas por IA.
 *
 * Stack:
 *   - @napi-rs/canvas (native C++ binding, ~similar a GD de PHP)
 *     para dibujar el texto con TTF reales — garantizado funciona
 *     en cualquier Linux sin depender de fontconfig.
 *   - sharp para componer el PNG del overlay sobre la imagen base.
 *
 * Fuentes:
 *   - client.fonts (TTF/OTF subidos por el user) descargados a /tmp y
 *     registrados con GlobalFonts.registerFromPath. Igual que el plugin
 *     PHP (NV Dashboard) que usaba imagettftext con la fuente del
 *     usuario.
 *   - Fallback Inter (Inter-Regular.ttf + Inter-Bold.ttf) commiteado
 *     en public/fonts/.
 *
 * Estilo:
 *   - Sin banda — sombra dibujada bajo cada texto.
 *   - text_placement decide la zona (top / center / bottom).
 *   - Pattern "frame": franja diagonal Reva-style.
 *   - Logo en esquina; se mueve a la mitad opuesta si coincide con
 *     la zona del texto.
 */

import sharp from "sharp";
import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
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

// ============================================================================
// CARGA DE FUENTES
// ============================================================================

const FONT_DIR = join(tmpdir(), "agencia-hub-fonts");
function ensureFontDir() {
  try {
    if (!existsSync(FONT_DIR)) mkdirSync(FONT_DIR, { recursive: true });
  } catch {}
}

const FONT_PATH_CACHE = new Map<string, string>(); // url → path local

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

const REGISTERED_FAMILIES = new Set<string>();

/**
 * Registra una fuente en GlobalFonts si aún no estaba. Devuelve el
 * nombre de familia bajo el que quedó registrada.
 */
function registerFontIfNeeded(path: string, family: string): string {
  const key = `${family}|${path}`;
  if (REGISTERED_FAMILIES.has(key)) return family;
  try {
    GlobalFonts.registerFromPath(path, family);
    REGISTERED_FAMILIES.add(key);
  } catch (e) {
    console.warn(`[overlay] no se pudo registrar fuente ${family} desde ${path}:`, (e as Error).message);
  }
  return family;
}

let interRegistered = false;
let interRegisteredReport: any = null;
function ensureInterRegistered(): { family: string; regularOk: boolean; boldOk: boolean } {
  if (interRegistered) return { family: "Inter", regularOk: true, boldOk: true };
  const root = process.cwd();
  const candidates = [
    join(root, "public", "fonts"),
    join(root, ".next", "standalone", "public", "fonts"),
    join(__dirname, "..", "..", "..", "public", "fonts"),
    join(__dirname, "..", "..", "public", "fonts"),
    join(__dirname, "..", "fonts"),
    "/app/public/fonts",
    "/app/.next/standalone/public/fonts"
  ];
  let regularOk = false;
  let boldOk = false;
  const triedPaths: any[] = [];
  for (const dir of candidates) {
    const reg = join(dir, "Inter-Regular.ttf");
    const bold = join(dir, "Inter-Bold.ttf");
    const regExists = existsSync(reg);
    const boldExists = existsSync(bold);
    triedPaths.push({ dir, regExists, boldExists });
    if (!regularOk && regExists) {
      try {
        GlobalFonts.registerFromPath(reg, "Inter");
        regularOk = true;
      } catch (e) {
        triedPaths[triedPaths.length - 1].regError = (e as Error).message;
      }
    }
    if (!boldOk && boldExists) {
      try {
        GlobalFonts.registerFromPath(bold, "Inter");
        boldOk = true;
      } catch (e) {
        triedPaths[triedPaths.length - 1].boldError = (e as Error).message;
      }
    }
    if (regularOk && boldOk) break;
  }
  // Fallback: si no encontramos los TTF en disco, decodificamos las
  // versiones base64 embebidas en el código fuente (sobrevive a
  // standalone build de Next.js sin importar cómo se copien los assets).
  if (!regularOk || !boldOk) {
    try {
      ensureFontDir();
      const { INTER_REGULAR_B64, INTER_BOLD_B64 } = require("./fonts-data") as {
        INTER_REGULAR_B64: string;
        INTER_BOLD_B64: string;
      };
      const regTmp = join(FONT_DIR, "Inter-Regular.ttf");
      const boldTmp = join(FONT_DIR, "Inter-Bold.ttf");
      if (!regularOk && INTER_REGULAR_B64) {
        if (!existsSync(regTmp)) writeFileSync(regTmp, Buffer.from(INTER_REGULAR_B64, "base64"));
        GlobalFonts.registerFromPath(regTmp, "Inter");
        regularOk = true;
        triedPaths.push({ source: "base64-embedded", regular: regTmp });
      }
      if (!boldOk && INTER_BOLD_B64) {
        if (!existsSync(boldTmp)) writeFileSync(boldTmp, Buffer.from(INTER_BOLD_B64, "base64"));
        GlobalFonts.registerFromPath(boldTmp, "Inter");
        boldOk = true;
        triedPaths.push({ source: "base64-embedded", bold: boldTmp });
      }
    } catch (e) {
      triedPaths.push({ source: "base64-embedded", error: (e as Error).message });
    }
  }
  interRegistered = regularOk || boldOk;
  interRegisteredReport = {
    regularOk,
    boldOk,
    cwd: root,
    __dirname: typeof __dirname !== "undefined" ? __dirname : "(undefined)",
    triedPaths,
    families: (GlobalFonts as any).families?.map?.((f: any) => f.family) ?? "(no families API)"
  };
  // Log siempre (no oculto detrás de env var) hasta que verifiquemos
  // que carga bien — luego haremos opt-in con DEBUG_OVERLAY_FONTS.
  console.log("[overlay] Inter registration:", JSON.stringify(interRegisteredReport));
  return { family: "Inter", regularOk, boldOk };
}

async function resolveFontFamily(clientFonts?: ClientFont[]): Promise<{
  family: string;
  hasBold: boolean;
}> {
  // Inter siempre (fallback universal)
  ensureInterRegistered();

  // Si el cliente sube fuentes (Montserrat etc), las registramos
  // bajo un nombre "BrandFont" y las usamos como principal.
  if (clientFonts && clientFonts.length > 0) {
    let registeredAny = false;
    let hasBoldClient = false;
    for (const f of clientFonts) {
      const path = await downloadFontToTmp(f.url);
      if (!path) continue;
      try {
        GlobalFonts.registerFromPath(path, "BrandFont");
        registeredAny = true;
        if (f.weight === "bold") hasBoldClient = true;
      } catch {}
    }
    if (registeredAny) {
      return { family: "BrandFont", hasBold: hasBoldClient || clientFonts.some((f) => f.weight === "bold") };
    }
  }
  return { family: "Inter", hasBold: true };
}

// ============================================================================
// RENDER PRINCIPAL
// ============================================================================

async function fetchBuffer(url: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo descargar ${url}: ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

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

  const { family } = await resolveFontFamily(opts.clientFonts);

  // Canvas separado solo para medir texto (necesario antes de saber la
  // altura total). Equivalente a imagettfbbox del plugin.
  const measureCanvas = createCanvas(width, height);
  const mctx = measureCanvas.getContext("2d");

  // Auto-fit por línea: si la línea con su tamaño solicitado se pasa del
  // ancho útil (width - 2*padding), bajamos el tamaño hasta que cabe.
  // Replica fit_text_size() del plugin PHP, pero línea a línea (Claude
  // ya las pre-partió).
  const maxLineW = width - padding * 2;
  const minFsAbs = Math.max(14, Math.round(height * 0.022));
  const lineHeights = lines.map((l) => {
    let fs = sizePx(l.size);
    const fw = l.weight === "bold" ? "bold" : "normal";
    while (fs > minFsAbs) {
      mctx.font = `${fw} ${fs}px "${family}", "Inter", system-ui, sans-serif`;
      const w = mctx.measureText(l.text).width;
      if (w <= maxLineW) break;
      fs -= 2;
    }
    return fs;
  });
  const gap = Math.round(height * 0.012);
  const totalH = lineHeights.reduce((a, b) => a + b, 0) + gap * (lines.length - 1);

  let y0: number;
  if (opts.textPlacement === "top") {
    y0 = padding + Math.round(height * 0.04);
  } else if (opts.textPlacement === "center") {
    y0 = Math.round((height - totalH) / 2);
  } else {
    y0 = height - padding - totalH;
  }

  // Crear canvas transparente para el overlay
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Frame diagonal estilo "Reva"
  if (opts.pattern === "frame") {
    ctx.fillStyle = primary;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(width * 0.6, 0);
    ctx.lineTo(width * 0.4, height * 0.32);
    ctx.lineTo(0, height * 0.32);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Dibujar cada línea con sombra estilo plugin:
  //   1) sombra sharp (sin blur) offset +2,+3 alpha ~0.21 negro
  //   2) fill plano con color brand
  //   3) faux-bold = redibujar offset +1px en X
  // Replica draw_text_with_thin_stroke() de class-rest-api.php:5805.
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.textBaseline = "alphabetic";
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fs = lineHeights[i];
    const fillColor = colorHex(l.color);
    const fontWeight = l.weight === "bold" ? "bold" : "normal";
    const yLine = y0 + lineHeights.slice(0, i).reduce((a, b) => a + b, 0) + i * gap + fs * 0.82;

    ctx.font = `${fontWeight} ${fs}px "${family}", "Inter", system-ui, sans-serif`;

    // 1) Sombra sharp offset (+2, +3) alpha 0.21
    ctx.fillStyle = "rgba(0, 0, 0, 0.21)";
    ctx.fillText(l.text, padding + 2, yLine + 3);

    // 2) Fill principal
    ctx.fillStyle = fillColor;
    ctx.fillText(l.text, padding, yLine);

    // 3) Faux-bold (refuerzo si la fuente bold no estaba realmente
    // disponible, igual que el plugin)
    if (l.weight === "bold") {
      ctx.fillText(l.text, padding + 1, yLine);
    }
  }

  // Logo en la esquina configurada
  if (opts.logoUrl) {
    try {
      const logoBuf = await fetchBuffer(opts.logoUrl);
      const targetW = Math.round(width * 0.16);
      const resizedLogo = await sharp(logoBuf).resize({ width: targetW, withoutEnlargement: false }).png().toBuffer();
      const logoImg = await loadImage(resizedLogo);
      const lw = logoImg.width;
      const lh = logoImg.height;
      const margin = Math.round(width * 0.04);
      const pos = opts.logoPosition ?? "br";
      let logoTop = pos.startsWith("t") ? margin : height - lh - margin;
      const logoLeft = pos.endsWith("r") ? width - lw - margin : margin;
      // Evita solapar con el texto
      if (opts.textPlacement === "top" && pos.startsWith("t")) {
        logoTop = height - lh - margin;
      }
      if (opts.textPlacement === "bottom" && !pos.startsWith("t")) {
        logoTop = margin;
      }
      ctx.drawImage(logoImg, logoLeft, logoTop);
    } catch (e) {
      console.warn("[overlay] logo failed:", (e as Error).message);
    }
  }

  // El canvas tiene fondo transparente: lo componemos sobre la imagen base
  const overlayPng = canvas.toBuffer("image/png");
  return await sharp(opts.baseBuffer).composite([{ input: overlayPng, top: 0, left: 0 }]).png().toBuffer();
}

// ============================================================================
// VERSIÓN LEGACY (re-apply overlay endpoint)
// ============================================================================

export async function composeOverlay(opts: OverlayOpts): Promise<Buffer> {
  const baseBuf = await fetchBuffer(opts.imageUrl);
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
