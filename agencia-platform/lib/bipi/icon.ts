/**
 * Genera PNG del icono Bipi al tamaño pedido. Reutilizado por las rutas
 * /bipi/icon-192.png, /bipi/icon-512.png y /bipi/icon-maskable-512.png.
 */

import sharp from "sharp";

const BG = "#EC4899";
const FG = "#FFFFFF";

function makeSvg(size: number, maskable: boolean): string {
  const pad = maskable ? Math.round(size * 0.15) : Math.round(size * 0.08);
  const inner = size - pad * 2;
  const fontSize = Math.round(inner * 0.42);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${BG}"/>
    <g transform="translate(${size / 2}, ${size / 2})">
      <text
        text-anchor="middle"
        dominant-baseline="middle"
        font-family="-apple-system, BlinkMacSystemFont, Inter, sans-serif"
        font-weight="900"
        font-size="${fontSize}"
        fill="${FG}"
      >bipi</text>
    </g>
  </svg>`;
}

export async function buildBipiIconPng(opts: { size: number; maskable?: boolean }): Promise<Buffer> {
  const svg = makeSvg(opts.size, !!opts.maskable);
  return sharp(Buffer.from(svg)).resize(opts.size, opts.size).png().toBuffer();
}
