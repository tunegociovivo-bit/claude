/**
 * Análisis profundo de imágenes para Sonia.
 *
 * Hoy Sonia ya "ve" imágenes vía completeVision para describirlas en
 * texto. Pero pierde detalle: no extrae paleta exacta hex, no estima
 * dimensiones de objetos físicos, no clasifica con taxonomía
 * estructurada.
 *
 * Esta función fuerza un schema JSON estricto sobre Anthropic vision
 * para que devuelva campos accionables:
 *
 *   { paletteHex: [...], dominantColor, objects: [...], materials,
 *     estimatedDimensions, vibe, suggestions, brandFitNotes }
 *
 * Usos típicos:
 *   - Cliente Reva (muebles): "dimensiones aproximadas y materiales"
 *     para fichas de producto + presupuestos.
 *   - Cliente Champiso (setas): "tipo de seta y guía de cocción"
 *     para descripción comercial.
 *   - Cualquier cliente: paleta exacta para que generate_brand_image
 *     se ajuste al tono real de su catálogo.
 */

import { getAnthropicForWorkspace } from "@/lib/ai/anthropic";

export type DeepImageAnalysis = {
  description: string;
  /** Paleta dominante en hex (3-8 colores). */
  paletteHex: string[];
  dominantColor: string;
  /** Objetos identificados con nivel de confianza. */
  objects: Array<{ name: string; confidence: "alta" | "media" | "baja" }>;
  /** Materiales visibles (textil, madera, metal, comida fresca, etc). */
  materials: string[];
  /** Dimensiones aproximadas si hay referencias de escala. */
  estimatedDimensions: string | null;
  /** Mood/vibe (minimalista, rústico, lujoso, urbano...). */
  vibe: string;
  /** Sugerencias accionables sobre la imagen. */
  suggestions: string[];
  /** Cómo encaja con la marca del cliente (si se pasó brandBrief). */
  brandFitNotes: string | null;
  /** Todos los textos visibles transcritos literalmente (OCR-style).
   *  Crítico para analizar anuncios publicitarios que el cliente usa
   *  como referencia: claim, CTA, value props, etc. */
  textsFound: string[];
  /** Composición / layout: 'regla de tercios', 'centrado simétrico',
   *  'full-bleed', 'asimétrico jerárquico', etc. */
  composition: string;
};

async function fetchAsBase64(url: string): Promise<{ data: string; mediaType: string }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No pude descargar la imagen: ${r.status}`);
  const ct = r.headers.get("content-type") ?? "image/jpeg";
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) {
    throw new Error(`Imagen demasiado grande (${buf.length} bytes)`);
  }
  return { data: buf.toString("base64"), mediaType: ct };
}

export async function deepAnalyzeImage(opts: {
  workspaceId: string;
  /** URL pública de la imagen (firmada de R2 vale). */
  imageUrl: string;
  /** Contexto opcional para enriquecer el análisis. */
  brandBrief?: string | null;
  clientIndustry?: string | null;
}): Promise<DeepImageAnalysis> {
  const client = await getAnthropicForWorkspace(opts.workspaceId);
  const img = await fetchAsBase64(opts.imageUrl);

  const systemPrompt =
    "Eres un analista visual experto. Vas a recibir una imagen y devolver un JSON ESTRICTO con campos estructurados. Sé preciso con los códigos hex (extráelos del dominante real, no del ambiente). Si no puedes estimar dimensiones, devuelve null. Los suggestions deben ser accionables (no obvios). Lenguaje: español de España.";

  const userPrompt =
    `Analiza la imagen y devuelve SOLO un JSON con este schema:\n\n` +
    `{\n` +
    `  "description": "1-2 frases describiendo qué se ve",\n` +
    `  "paletteHex": ["#XXXXXX", ...] // 3-8 colores dominantes,\n` +
    `  "dominantColor": "#XXXXXX",\n` +
    `  "objects": [{ "name": "...", "confidence": "alta|media|baja" }],\n` +
    `  "materials": ["...", "..."],\n` +
    `  "estimatedDimensions": "ej. 200x80x70cm aprox" | null,\n` +
    `  "vibe": "minimalista|rústico|lujoso|...",\n` +
    `  "suggestions": ["...", "..."] // 2-4 acciones,\n` +
    `  "brandFitNotes": "..." | null,\n` +
    `  "textsFound": ["...", "..."] // TODOS los textos visibles transcritos literalmente (claim, CTA, USPs, branding). Lista vacía si no hay textos.,\n` +
    `  "composition": "regla de tercios|centrado simétrico|full-bleed|asimétrico jerárquico|..."\n` +
    `}\n\n` +
    (opts.brandBrief
      ? `Brand brief del cliente:\n${opts.brandBrief.slice(0, 1200)}\n\n`
      : "") +
    (opts.clientIndustry
      ? `Industria del cliente: ${opts.clientIndustry}\n\n`
      : "") +
    `IMPORTANTE: devuelve SOLO el JSON, sin markdown, sin explicaciones extra.`;

  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: img.mediaType as any,
              data: img.data
            }
          },
          { type: "text", text: userPrompt }
        ]
      }
    ]
  } as any);

  const text =
    (resp.content.find((b: any) => b.type === "text") as any)?.text?.trim() ?? "";
  // Extrae el JSON aunque venga rodeado de prosa
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error("La IA no devolvió JSON válido");
  try {
    const parsed = JSON.parse(m[0]) as DeepImageAnalysis;
    // Validación mínima
    if (!Array.isArray(parsed.paletteHex)) parsed.paletteHex = [];
    if (!Array.isArray(parsed.objects)) parsed.objects = [];
    if (!Array.isArray(parsed.materials)) parsed.materials = [];
    if (!Array.isArray(parsed.suggestions)) parsed.suggestions = [];
    if (!Array.isArray(parsed.textsFound)) parsed.textsFound = [];
    if (typeof parsed.composition !== "string") parsed.composition = "";
    return parsed;
  } catch (e: any) {
    throw new Error(`JSON inválido del modelo: ${e?.message}`);
  }
}
