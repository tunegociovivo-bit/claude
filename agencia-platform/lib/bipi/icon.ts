/**
 * Genera PNG del icono Bipi al tamaño pedido. Reutilizado por las rutas
 * /bipi/icon-192.png, /bipi/icon-512.png y /bipi/icon-maskable-512.png.
 */

import sharp from "sharp";

const BG = "#EC4899";
const BG2 = "#DB2777";
const FG = "#FFFFFF";

function makeSvg(size: number, maskable: boolean): string {
  const pad = maskable ? Math.round(size * 0.15) : Math.round(size * 0.08);
  const inner = size - pad * 2;
  const fontSize = Math.round(inner * 0.42);
  // Diana (bullseye) sobre la última i: anillo blanco + hueco rosa + punto
  // blanco. Posicionada sobre el punto nativo de la última i para que se
  // fusione y lea como "la diana es el punto de la i".
  const R = fontSize * 0.185;
  const bx = fontSize * 0.76;
  const by = -fontSize * 0.52;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${BG}"/>
        <stop offset="1" stop-color="${BG2}"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#bg)"/>
    <g transform="translate(${size / 2}, ${size / 2})">
      <text
        text-anchor="middle"
        dominant-baseline="middle"
        font-family="-apple-system, BlinkMacSystemFont, Inter, sans-serif"
        font-weight="900"
        font-size="${fontSize}"
        fill="${FG}"
      >bipi</text>
      <circle cx="${bx}" cy="${by}" r="${R}" fill="${FG}"/>
      <circle cx="${bx}" cy="${by}" r="${R * 0.58}" fill="${BG2}"/>
      <circle cx="${bx}" cy="${by}" r="${R * 0.26}" fill="${FG}"/>
    </g>
  </svg>`;
}

export async function buildBipiIconPng(opts: { size: number; maskable?: boolean }): Promise<Buffer> {
  const svg = makeSvg(opts.size, !!opts.maskable);
  return sharp(Buffer.from(svg)).resize(opts.size, opts.size).png().toBuffer();
}
