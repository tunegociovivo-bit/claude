/**
 * Análisis IA del cliente: lee la web pública (HTML), extrae colores y
 * resumen de marca, y genera la guía de estilo a partir de las refs
 * visuales.
 *
 * Sin Claude vision (todavía no integrado): usamos texto plano + URLs de
 * imágenes en el prompt para que Claude extraiga lo que pueda.
 */

import { prisma } from "@/lib/db/prisma";
import { completeJson, complete, completeVision } from "@/lib/ai/anthropic";
import { createHash } from "crypto";
import { fetchText } from "@/lib/leads/email-extract";
import { resignBrandAssets } from "@/lib/content/brand";

type ReferenceImage = { url: string; type?: string; personName?: string };

/** URL sin query (las firmas de /api/files y S3 cambian al re-firmar). */
function stableUrl(url: string): string {
  try {
    const u = new URL(url, "http://local.invalid");
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Análisis de la web del cliente. Hace fetch al HTML, le pasa a Claude el
 * texto + URLs de imágenes para que devuelva colores estimados y un resumen
 * del posicionamiento.
 */
export async function analyzeClientWebsite(opts: {
  workspaceId: string;
  url: string;
}): Promise<{
  summary: string;
  brandColors: { primary: string; accent: string; text: string };
  detectedFonts: string[];
  rawHtmlLength: number;
}> {
  let html: string;
  try {
    // CRM: descarga segura (solo IPs públicas, DNS fijado, tamaño máximo).
    // Cada negocio puede escribir cualquier URL, así que nunca se hace un
    // fetch directo que pueda alcanzar servicios internos.
    html = await fetchText(opts.url);
    if (!html) throw new Error("la página no respondió con HTML");
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    throw new Error(`No se pudo leer la web: ${msg === "private_host" ? "dirección no permitida" : msg}`);
  }

  // Extract text content + image urls + meta tags (very rough)
  const textOnly = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);

  const inlineColors = Array.from(html.matchAll(/#([0-9a-fA-F]{6})\b/g))
    .map((m) => `#${m[1].toUpperCase()}`)
    .slice(0, 50);

  const fontFamilies = Array.from(html.matchAll(/font-family\s*:\s*([^;"'}]+)/gi))
    .map((m) => m[1].trim())
    .slice(0, 10);

  const system = `Eres un brand analyst. Te paso el contenido textual + colores hex detectados de la web de una marca.
Devuelve JSON con:
- summary: 3-5 frases sobre qué hace la marca, su posicionamiento, tono y audiencia.
- brandColors: {primary, accent, text} en hex. Elige los 3 colores que mejor representen la marca de los detectados (no necesariamente los más frecuentes — los que mejor encajen como brand). Si no hay suficientes, sugiere unos coherentes.
- detectedFonts: array de 2-3 nombres de fuentes (puede estar vacío si no detectas ninguna).`;

  const user = `## Web a analizar
URL: ${opts.url}

## Texto extraído (truncado)
${textOnly}

## Colores hex detectados en el CSS inline
${inlineColors.join(", ") || "(ninguno)"}

## Fuentes detectadas
${fontFamilies.join(", ") || "(ninguna)"}`;

  const out = await completeJson<{
    summary: string;
    brandColors: { primary: string; accent: string; text: string };
    detectedFonts: string[];
  }>({
    workspaceId: opts.workspaceId,
    system,
    user,
    schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        brandColors: {
          type: "object",
          properties: {
            primary: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
            accent: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
            text: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }
          },
          required: ["primary", "accent", "text"]
        },
        detectedFonts: { type: "array", items: { type: "string" } }
      },
      required: ["summary", "brandColors", "detectedFonts"]
    } as any,
    maxTokens: 1500
  });

  return { ...out, rawHtmlLength: html.length };
}

/**
 * Genera la guía de estilo cacheada a partir de las imágenes de referencia
 * del cliente. Versión texto-only (sin vision): le pasamos las URLs a
 * Claude para que las analice por su training previo o devuelva una guía
 * genérica basada en los tipos/categorías.
 *
 * Para vision real, hay que pasar las imágenes como content blocks de tipo
 * "image". Lo haremos cuando integremos visión.
 */
export async function generateStyleGuide(opts: {
  workspaceId: string;
  clientId: string;
}): Promise<{
  styleGuide: string;
  hash: string;
}> {
  const stored = await prisma.contentBrand.findFirst({
    where: { id: opts.clientId, workspaceId: opts.workspaceId, deletedAt: null }
  });
  if (!stored) throw new Error("Ficha de marca no encontrada");
  // URLs re-firmadas para descargar las imágenes (la caché usa la URL sin firma).
  const client = await resignBrandAssets(stored, opts.workspaceId);

  const refs = (client.referenceImages as ReferenceImage[] | null) ?? [];
  if (refs.length === 0) {
    throw new Error("Tu marca no tiene imágenes de referencia. Súbelas primero en la ficha de marca.");
  }

  // Hash de las refs para invalidar la caché cuando cambien. CRM: se usa la
  // URL sin parámetros de firma (que cambian al re-firmar).
  const refsString = refs
    .map((r) => `${stableUrl(r.url)}|${r.type ?? ""}|${r.personName ?? ""}`)
    .sort()
    .join("\n");
  const hash = createHash("md5").update(refsString).digest("hex").slice(0, 16);

  // Si ya tenemos un guide con este hash, devolverlo
  if (client.styleGuideCached && client.styleGuideHash === hash) {
    return { styleGuide: client.styleGuideCached, hash };
  }

  const grouped: Record<string, ReferenceImage[]> = {};
  for (const r of refs) {
    const k = r.type ?? "general";
    (grouped[k] ??= []).push(r);
  }

  const system = `You are a brand visual analyst. You will be shown reference images of a brand grouped by category (CEO, team, facilities, etc.). Analyze them visually and produce a STYLE GUIDE IN ENGLISH (best language for the image model) of 800-1500 characters describing:
- Color palette and mood (extract dominant colors as hex codes when possible)
- Typography and composition pattern
- Lighting and atmosphere of the photos
- People appearing (name + role if provided in the metadata I'll send)
- What the brand DOES and DOES NOT do visually

Structure: short paragraphs, no bullet lists. Professional but actionable tone.`;

  // Metadata textual + imágenes como bloques vision
  const refsMeta = Object.entries(grouped)
    .map(([type, items]) => {
      return `### ${type}\n${items
        .map((i, idx) => `- image #${idx + 1}: ${i.personName ? `person ${i.personName}` : "(unnamed)"}`)
        .join("\n")}`;
    })
    .join("\n\n");

  const userText = `## Client
${client.name}${client.brandBrief ? `\n\nBrief: ${client.brandBrief}` : ""}

## Reference images (grouped by category)
${refsMeta}

I'm passing you the actual image data with this message. Analyze them visually and produce the style guide.`;

  // Limitamos a 16 imágenes (la API soporta más pero ahorramos tokens y latencia)
  const imageUrls = refs.slice(0, 16).map((r) => r.url);

  const guide = await completeVision({
    workspaceId: opts.workspaceId,
    feature: "editorial_style_guide_vision",
    system,
    userText,
    imageUrls,
    maxTokens: 2500
  });

  await prisma.contentBrand.updateMany({
    where: { id: opts.clientId, workspaceId: opts.workspaceId },
    data: { styleGuideCached: guide, styleGuideHash: hash }
  });

  return { styleGuide: guide, hash };
}
