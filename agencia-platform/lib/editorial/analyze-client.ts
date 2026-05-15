/**
 * Análisis IA del cliente: lee la web pública (HTML), extrae colores y
 * resumen de marca, y genera la guía de estilo a partir de las refs
 * visuales.
 *
 * Sin Claude vision (todavía no integrado): usamos texto plano + URLs de
 * imágenes en el prompt para que Claude extraiga lo que pueda.
 */

import { prisma } from "@/lib/db/prisma";
import { completeJson, complete } from "@/lib/ai/anthropic";
import { createHash } from "crypto";

type ReferenceImage = { url: string; type?: string; personName?: string };

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
    const r = await fetch(opts.url, {
      headers: { "User-Agent": "AgenciaHub/1.0 (+https://hub.negociovivo.app)" },
      signal: AbortSignal.timeout(15_000)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    html = await r.text();
  } catch (e: any) {
    throw new Error(`No se pudo leer la web: ${e?.message ?? e}`);
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
  const client = await prisma.client.findFirst({
    where: { id: opts.clientId, workspaceId: opts.workspaceId, deletedAt: null }
  });
  if (!client) throw new Error("Cliente no encontrado");

  const refs = (client.referenceImages as ReferenceImage[] | null) ?? [];
  if (refs.length === 0) {
    throw new Error("El cliente no tiene imágenes de referencia. Súbelas primero en /clientes/[id]/editorial.");
  }

  // Hash de las refs para invalidar la caché cuando cambien
  const refsString = refs
    .map((r) => `${r.url}|${r.type ?? ""}|${r.personName ?? ""}`)
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

  const system = `Eres un brand visual analyst. Te paso categorías y URLs de imágenes de referencia de una marca.
Devuelve una guía de estilo visual en INGLÉS (es el idioma que mejor procesa el modelo de imagen) de 800-1500 caracteres que describa:
- Paleta de color y mood
- Tipografía y composición típica
- Iluminación y atmósfera de las fotos
- Personas que aparecen (nombre + rol si se proporciona)
- Lo que la marca SÍ y NO hace visualmente

Estructura: párrafos breves, no listas. Tono profesional pero ejecutable.`;

  const refsBlock = Object.entries(grouped)
    .map(([type, items]) => {
      return `### ${type}\n${items.map((i) => `- ${i.url}${i.personName ? ` (persona: ${i.personName})` : ""}`).join("\n")}`;
    })
    .join("\n\n");

  const user = `## Cliente
${client.name}${client.brandBrief ? `\n\nBrief: ${client.brandBrief}` : ""}

## Imágenes de referencia (agrupadas por categoría)

${refsBlock}

## Tu salida
Devuelve la guía de estilo visual en inglés.`;

  const guide = await complete({
    workspaceId: opts.workspaceId,
    feature: "editorial_style_guide",
    system,
    user,
    maxTokens: 2500
  });

  await prisma.client.update({
    where: { id: opts.clientId },
    data: { styleGuideCached: guide, styleGuideHash: hash }
  });

  return { styleGuide: guide, hash };
}
