/**
 * GET /api/bubui/business/[id]/poster.png?style=cosy|bold|fresh
 *
 * Genera un cartel PNG bonito con el QR del negocio incrustado en el
 * centro y branding alrededor (nombre, lema, "Escanea, llévate %"…).
 *
 * Pipeline:
 *   1) gpt-image-1 genera el FONDO del cartel (sin texto, dejando un
 *      cuadrado vacío para el QR).
 *   2) Generamos el QR del negocio (PNG transparente).
 *   3) Componemos con sharp: fondo + bloque blanco centro + QR + texto.
 *
 * Si falta OPENAI_API_KEY, devuelve un cartel sólido pero sin fondo IA
 * (fallback) — el negocio puede seguir imprimiendo igual.
 */

import { NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/db/prisma";
import { generateBusinessQrPng, bubuiScanUrl } from "@/lib/bubui/core";
import { getQrPosterConfig, composeQrPoster } from "@/lib/bubui/qr-poster";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const STYLES: Record<string, { prompt: string; palette: { bg: string; fg: string; accent: string } }> = {
  cosy: {
    prompt:
      "bright pink and white poster background with soft pink gradient washes and playful shapes, modern feminine retail flyer aesthetic, lots of empty space in the center for a QR code, no text, no letters, no numbers, no logos",
    palette: { bg: "#FDF2F8", fg: "#000000", accent: "#EC4899" }
  },
  bold: {
    prompt:
      "bold modern editorial poster background, jet black + hot pink color blocks, geometric shapes, fashion magazine aesthetic, large empty area in the center for a QR code, no text, no letters, no numbers, no logos",
    palette: { bg: "#000000", fg: "#FFFFFF", accent: "#EC4899" }
  },
  fresh: {
    prompt:
      "fresh white and bubble-gum pink poster background, clean minimalist flyer aesthetic with subtle confetti or stars accents, large empty area in the center for a QR code, no text, no letters, no numbers, no logos",
    palette: { bg: "#FFFFFF", fg: "#000000", accent: "#EC4899" }
  }
};

const POSTER_SIZE = 1080; // ancho final px (cuadrado, A4-printable a ~270 DPI)

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;"
  })[c] as string);
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const url = new URL(req.url);
  const style = (url.searchParams.get("style") ?? "cosy") as keyof typeof STYLES;
  const styleDef = STYLES[style] ?? STYLES.cosy;

  const business = await prisma.bubuiBusiness.findUnique({ where: { id: params.id } });
  if (!business) return new NextResponse("Not found", { status: 404 });

  const baseUrl = new URL(req.url).origin;

  // ── Plantilla oficial (si el admin la subió): mismo cartel de marca para
  //    todos los comercios, con SU QR compuesto encima. Tiene prioridad
  //    sobre el cartel generado por estilos. ──
  try {
    const tplConfig = await getQrPosterConfig();
    if (tplConfig) {
      const png = await composeQrPoster({ config: tplConfig, businessId: business.id, baseUrl });
      return new NextResponse(new Uint8Array(png), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `inline; filename="bubui-cartel-${business.slug}.png"`,
          "Cache-Control": "private, max-age=300"
        }
      });
    }
  } catch (e: any) {
    // Si la plantilla falla (URL caída…), caemos al cartel generado clásico.
    console.warn("[bubui poster template]", e?.message ?? e);
  }

  // 1) QR del negocio
  const qrPng = await generateBusinessQrPng({ businessId: business.id, baseUrl, size: 520 });

  // 2) Fondo IA (con fallback al color sólido si OpenAI no disponible)
  let bgPng: Buffer | null = null;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const fullPrompt = `${styleDef.prompt}. Spanish retail business poster for "${business.name}" (${business.category}). The composition must leave a generous CENTERED empty area (approx 50% of the canvas) where a QR code will be placed by post-processing. The rest of the poster has decorative branding around — corners, top header band, bottom footer band — but the dead-center stays light and clean.`;
      const resp = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-image-1",
          prompt: fullPrompt.slice(0, 32_000),
          size: "1024x1024",
          quality: "medium",
          n: 1
        }),
        signal: AbortSignal.timeout(90_000)
      });
      if (resp.ok) {
        const data: any = await resp.json();
        const b64 = data?.data?.[0]?.b64_json;
        if (b64) bgPng = Buffer.from(b64, "base64");
      } else {
        console.warn("[bubui poster] openai", resp.status, (await resp.text()).slice(0, 200));
      }
    } catch (e: any) {
      console.warn("[bubui poster] openai error:", e?.message ?? e);
    }
  }

  // Si no hay fondo IA, generamos uno sólido con el color del estilo.
  if (!bgPng) {
    bgPng = await sharp({
      create: { width: POSTER_SIZE, height: POSTER_SIZE, channels: 3, background: styleDef.palette.bg }
    })
      .png()
      .toBuffer();
  }

  // 3) Composición final
  const headline = escapeXml(business.name);
  const subheadline = escapeXml(business.category);
  const offer = `LLÉVATE ${business.defaultDiscountPct}% AL ESCANEAR`;

  // Caja blanca semitransparente en el centro para el QR + textos overlay.
  const qrBox = 580;
  const qrPad = 30;
  const qrPositionX = (POSTER_SIZE - qrBox) / 2;
  const qrPositionY = (POSTER_SIZE - qrBox) / 2;

  const textSvg = `
    <svg width="${POSTER_SIZE}" height="${POSTER_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <style>
        /* Sharp / librsvg solo puede usar fuentes del sistema; un @import a
           Google Fonts no se resuelve aquí (resultado: cuadrados ▢▢). Usamos
           la familia genérica sans-serif que en el Linux base de Railway
           se resuelve a DejaVu Sans. */
        .name { font: 900 60px sans-serif; fill: ${styleDef.palette.fg}; }
        .cat  { font: 400 30px sans-serif; fill: ${styleDef.palette.fg}; opacity: 0.8; }
        .off  { font: 900 38px sans-serif; fill: ${styleDef.palette.accent}; }
        .hint { font: 600 24px sans-serif; fill: ${styleDef.palette.fg}; opacity: 0.85; }
        .brand{ font: 800 28px sans-serif; fill: ${styleDef.palette.accent}; }
      </style>
      <text x="50%" y="100" text-anchor="middle" class="brand">bubui</text>
      <text x="50%" y="170" text-anchor="middle" class="name">${headline}</text>
      <text x="50%" y="215" text-anchor="middle" class="cat">${subheadline}</text>
      <rect x="${qrPositionX - qrPad}" y="${qrPositionY - qrPad}" width="${qrBox + qrPad * 2}" height="${qrBox + qrPad * 2}" rx="40" fill="white" opacity="0.92"/>
      <text x="50%" y="${POSTER_SIZE - 140}" text-anchor="middle" class="off">${offer}</text>
      <text x="50%" y="${POSTER_SIZE - 95}" text-anchor="middle" class="hint">Escanea con la app bubui · llévate descuentos cerca</text>
    </svg>
  `;

  const final = await sharp(bgPng)
    .resize(POSTER_SIZE, POSTER_SIZE, { fit: "cover" })
    .composite([
      { input: Buffer.from(textSvg), top: 0, left: 0 },
      {
        input: await sharp(qrPng).resize(qrBox, qrBox).png().toBuffer(),
        top: qrPositionY,
        left: qrPositionX
      }
    ])
    .png()
    .toBuffer();

  return new NextResponse(final as any, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
