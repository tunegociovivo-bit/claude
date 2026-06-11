/**
 * Cartel QR de marca para TODOS los comercios.
 *
 * El admin sube UNA plantilla (el póster de Bubui con su QR de muestra) desde
 * su panel; aquí se compone el QR REAL de cada negocio encima, tapando el de
 * muestra. Así cada comercio imprime un cartel con toda la info de la app, y
 * si pide que se lo llevemos, el equipo lo imprime ya montado.
 *
 * Config en BubuiSetting (key "qr_poster_template"):
 *   { url: string, qr?: { x, y, w, h } }   // fracciones 0-1 sobre la plantilla
 *
 * Las fracciones por defecto están medidas sobre la plantilla oficial (la
 * tarjeta blanca del QR): se pueden ajustar vía PATCH del admin sin deploy.
 */
import sharp from "sharp";
import { prisma } from "@/lib/db/prisma";
import { generateBusinessQrPng } from "@/lib/bubui/core";

const KEY = "qr_poster_template";

export type QrPosterConfig = {
  url: string;
  /** Zona de la tarjeta del QR en fracciones (0-1) del ancho/alto. */
  qr: { x: number; y: number; w: number; h: number };
};

/** Zona del QR (tarjeta blanca nueva). Más estrecha que la tarjeta de muestra
 *  de la plantilla para dejar aire con el borde derecho del póster. */
const DEFAULT_QR_AREA = { x: 0.515, y: 0.329, w: 0.425, h: 0.311 };
/** Hasta dónde llega la tarjeta de muestra ORIGINAL de la plantilla (borde
 *  derecho, en fracción). La franja entre la tarjeta nueva y este límite se
 *  tapa clonando el fondo de la propia plantilla. */
const ORIGINAL_CARD_RIGHT = 0.978;

export async function getQrPosterConfig(): Promise<QrPosterConfig | null> {
  const row = await prisma.bubuiSetting.findUnique({ where: { key: KEY } });
  if (!row) return null;
  try {
    const v = JSON.parse(row.value);
    if (!v?.url) return null;
    const f = (n: any, d: number) => (typeof n === "number" && n > 0 && n < 1 ? n : d);
    let qr = {
      x: f(v?.qr?.x, DEFAULT_QR_AREA.x),
      y: f(v?.qr?.y, DEFAULT_QR_AREA.y),
      w: f(v?.qr?.w, DEFAULT_QR_AREA.w),
      h: f(v?.qr?.h, DEFAULT_QR_AREA.h)
    };
    // Migración: configs guardadas con los defaults antiguos (tarjeta hasta
    // el borde) pasan a usar los nuevos (con aire a la derecha).
    if (Math.abs(qr.w - 0.458) < 1e-6 && Math.abs(qr.x - 0.515) < 1e-6) {
      qr = { ...DEFAULT_QR_AREA };
    }
    return { url: String(v.url), qr };
  } catch {
    return null;
  }
}

export async function setQrPosterConfig(cfg: { url: string; qr?: Partial<QrPosterConfig["qr"]> }): Promise<QrPosterConfig> {
  const next: QrPosterConfig = {
    url: cfg.url,
    qr: {
      x: cfg.qr?.x ?? DEFAULT_QR_AREA.x,
      y: cfg.qr?.y ?? DEFAULT_QR_AREA.y,
      w: cfg.qr?.w ?? DEFAULT_QR_AREA.w,
      h: cfg.qr?.h ?? DEFAULT_QR_AREA.h
    }
  };
  await prisma.bubuiSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) }
  });
  return next;
}

/**
 * Compone la plantilla con el QR real del negocio: tarjeta blanca redondeada
 * cubriendo la zona del QR de muestra + QR centrado dentro. Devuelve PNG.
 */
export async function composeQrPoster(opts: {
  config: QrPosterConfig;
  businessId: string;
  baseUrl: string;
}): Promise<Buffer> {
  const resp = await fetch(opts.config.url, { signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`No se pudo descargar la plantilla (${resp.status})`);
  const tplBuf = Buffer.from(await resp.arrayBuffer());

  const tpl = sharp(tplBuf);
  const meta = await tpl.metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error("Plantilla sin dimensiones");

  const area = {
    x: Math.round(opts.config.qr.x * W),
    y: Math.round(opts.config.qr.y * H),
    w: Math.round(opts.config.qr.w * W),
    h: Math.round(opts.config.qr.h * H)
  };

  const composites: sharp.OverlayOptions[] = [];

  // Si la tarjeta nueva es más estrecha que la de muestra de la plantilla,
  // la franja sobrante de la tarjeta original quedaría visible. La tapamos
  // clonando una columna del fondo de la plantilla (justo a la derecha de la
  // tarjeta) estirada sobre la franja → se funde con el degradado sin costura.
  const coverRight = Math.round(ORIGINAL_CARD_RIGHT * W);
  const newRight = area.x + area.w;
  if (coverRight > newRight + 2) {
    const stripX = newRight - 2; // pequeño solape con la tarjeta nueva
    const stripW = coverRight - stripX;
    const stripY = Math.max(0, area.y - Math.round(H * 0.006));
    const stripH = Math.min(H - stripY, area.h + Math.round(H * 0.012));
    const sampleX = Math.min(W - 5, coverRight + Math.round(W * 0.006));
    const bgColumn = await sharp(tplBuf)
      .extract({ left: sampleX, top: stripY, width: 4, height: stripH })
      .resize(stripW, stripH, { fit: "fill" })
      .png()
      .toBuffer();
    composites.push({ input: bgColumn, left: stripX, top: stripY });
  }

  // Tarjeta blanca redondeada que tapa por completo el QR de muestra.
  const radius = Math.round(Math.min(area.w, area.h) * 0.09);
  const cardSvg = Buffer.from(
    `<svg width="${area.w}" height="${area.h}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="100%" height="100%" rx="${radius}" ry="${radius}" fill="#FFFFFF"/>` +
      `</svg>`
  );

  // QR cuadrado centrado dentro de la tarjeta, con margen.
  const pad = Math.round(Math.min(area.w, area.h) * 0.07);
  const qrSide = Math.min(area.w, area.h) - pad * 2;
  const qrPng = await generateBusinessQrPng({
    businessId: opts.businessId,
    baseUrl: opts.baseUrl,
    size: qrSide
  });
  const qrResized = await sharp(qrPng).resize(qrSide, qrSide, { fit: "contain" }).png().toBuffer();

  composites.push(
    { input: cardSvg, left: area.x, top: area.y },
    {
      input: qrResized,
      left: area.x + Math.round((area.w - qrSide) / 2),
      top: area.y + Math.round((area.h - qrSide) / 2)
    }
  );

  return sharp(tplBuf).composite(composites).png().toBuffer();
}
