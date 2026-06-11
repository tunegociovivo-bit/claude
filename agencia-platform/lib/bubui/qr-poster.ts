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

/** Zona del QR medida sobre la plantilla oficial. */
const DEFAULT_QR_AREA = { x: 0.515, y: 0.329, w: 0.458, h: 0.312 };

export async function getQrPosterConfig(): Promise<QrPosterConfig | null> {
  const row = await prisma.bubuiSetting.findUnique({ where: { key: KEY } });
  if (!row) return null;
  try {
    const v = JSON.parse(row.value);
    if (!v?.url) return null;
    const f = (n: any, d: number) => (typeof n === "number" && n > 0 && n < 1 ? n : d);
    return {
      url: String(v.url),
      qr: {
        x: f(v?.qr?.x, DEFAULT_QR_AREA.x),
        y: f(v?.qr?.y, DEFAULT_QR_AREA.y),
        w: f(v?.qr?.w, DEFAULT_QR_AREA.w),
        h: f(v?.qr?.h, DEFAULT_QR_AREA.h)
      }
    };
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

  return sharp(tplBuf)
    .composite([
      { input: cardSvg, left: area.x, top: area.y },
      {
        input: qrResized,
        left: area.x + Math.round((area.w - qrSide) / 2),
        top: area.y + Math.round((area.h - qrSide) / 2)
      }
    ])
    .png()
    .toBuffer();
}
