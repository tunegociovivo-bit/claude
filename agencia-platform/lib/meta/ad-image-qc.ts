/**
 * Quality control de imágenes Meta Ads generadas por IA.
 *
 * gpt-image-1 alucina texto en español con regularidad (5-15% de
 * generaciones tienen erratas tipo "Esfudio gratumo" en vez de
 * "Estudio gratuito"). En un anuncio de despacho de abogados serio
 * eso es inaceptable.
 *
 * Esta función:
 *   1. Hace OCR de la imagen generada con Claude Haiku vision (barato)
 *   2. Compara contra los textos que se pidieron renderizar
 *   3. Devuelve { passed: boolean, mismatches: [...] }
 *
 * El caller decide si regenera o no en función del resultado.
 */

import { getAnthropicForWorkspace } from "@/lib/ai/anthropic";
import { logAiUsage } from "@/lib/ai/usage";

export type QcExpected = {
  headline?: string;
  primaryText?: string;
  callToAction?: string;
  valueProps?: string[];
  brandName?: string;
};

export type QcResult = {
  passed: boolean;
  /** Textos que esperábamos y que NO aparecen (o con erratas) en la imagen. */
  mismatches: Array<{ expected: string; reason: string }>;
  /** Textos que SÍ aparecen correctamente. */
  matched: string[];
  /** OCR raw que devolvió la IA. */
  ocrText: string;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[¿?¡!.,:;"'`´´“”‘’()\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Devuelve true si el texto esperado aparece (sustring fuzzy) en el OCR. */
function isPresent(expected: string, ocr: string): boolean {
  const e = normalize(expected);
  const o = normalize(ocr);
  if (!e) return true;
  // Match directo
  if (o.includes(e)) return true;
  // Match palabra a palabra: si >70% de las palabras del expected
  // aparecen en el OCR, lo damos por bueno (gpt-image a veces omite
  // signos de puntuación, conjunciones, etc.)
  const words = e.split(" ").filter((w) => w.length >= 3);
  if (words.length === 0) return false;
  const found = words.filter((w) => o.includes(w));
  return found.length / words.length >= 0.7;
}

export async function ocrAdImageBuffer(opts: {
  workspaceId: string;
  imageBase64: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
}): Promise<string> {
  const client = await getAnthropicForWorkspace(opts.workspaceId);
  const model = "claude-haiku-4-5";
  const resp = await client.messages.create({
    model,
    max_tokens: 800,
    system:
      "Eres un OCR. Devuelves SOLO el texto visible en la imagen, transcrito literalmente, conservando saltos de línea. Sin explicaciones.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: opts.mediaType,
              data: opts.imageBase64
            } as any
          } as any,
          {
            type: "text",
            text: "Transcribe TODO el texto visible en esta imagen. Si hay erratas en el texto renderizado (letras que parecen alucinadas por IA), reprodúcelas EXACTAS — quiero ver lo que la imagen dice literalmente, no lo que debería decir."
          }
        ]
      }
    ]
  });

  await logAiUsage({
    workspaceId: opts.workspaceId,
    feature: "ad_image_qc",
    provider: "anthropic",
    model,
    inputTokens: resp.usage?.input_tokens ?? 0,
    outputTokens: resp.usage?.output_tokens ?? 0
  }).catch(() => {});

  return resp.content
    .map((b) => (b.type === "text" ? (b as any).text : ""))
    .join("")
    .trim();
}

export function qcCompareTexts(
  ocrText: string,
  expected: QcExpected
): QcResult {
  const mismatches: Array<{ expected: string; reason: string }> = [];
  const matched: string[] = [];

  function check(label: string, value: string | undefined) {
    if (!value || !value.trim()) return;
    if (isPresent(value, ocrText)) {
      matched.push(`${label}: "${value}"`);
    } else {
      mismatches.push({
        expected: `${label}: "${value}"`,
        reason: "no encontrado en la imagen o con erratas"
      });
    }
  }

  check("headline", expected.headline);
  check("primaryText", expected.primaryText);
  check("CTA", expected.callToAction);
  check("brandName", expected.brandName);
  for (const v of expected.valueProps ?? []) {
    check("valueProp", v);
  }

  return {
    passed: mismatches.length === 0,
    mismatches,
    matched,
    ocrText
  };
}

export async function qcAdImage(opts: {
  workspaceId: string;
  imageBuffer: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  expected: QcExpected;
}): Promise<QcResult> {
  const ocrText = await ocrAdImageBuffer({
    workspaceId: opts.workspaceId,
    imageBase64: opts.imageBuffer.toString("base64"),
    mediaType: opts.mimeType
  });
  return qcCompareTexts(ocrText, opts.expected);
}
