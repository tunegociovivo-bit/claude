/**
 * Generador de fotos de portada con IA para Bubui.
 *
 * Usa la API de imágenes de OpenAI (modelo gpt-image-1) — HTTP directo
 * para no añadir SDK pesado. Devuelve un PNG en base64 que el endpoint
 * sube a R2/S3 (lib/storage/r2) y entrega como URL pública o firmada.
 *
 * Sin OPENAI_API_KEY: isPhotoAiEnabled() → false y el endpoint responde
 * 503 "ai_off". Sin storage configurado, devolvemos data: URL inline
 * (el cliente puede previsualizar y guardarla luego como logoUrl).
 */

export function isPhotoAiEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function generateBusinessHeroImage(opts: {
  /** Negocio: nombre + categoría → contexto del prompt del dueño. */
  businessName: string;
  category: string;
  /** Lo que el dueño escribe (estilo, ambiente, producto destacado…) */
  userPrompt: string;
  /** 16:9 portada vs cuadrado para el logo. */
  aspect?: "wide" | "square";
}): Promise<{ pngBase64: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY no configurada");

  const size = opts.aspect === "square" ? "1024x1024" : "1536x1024";
  // Prompt curado para evitar las trampas más habituales (texto basura,
  // logos inventados, baja calidad). Se evita generar texto en la imagen
  // porque los modelos de imagen no rinden bien con tipografía y queda
  // poco profesional para una portada de negocio.
  const finalPrompt = [
    `Hero photo for a small local business named "${opts.businessName}" (${opts.category}).`,
    `Style: ${opts.userPrompt}.`,
    "Photorealistic, magazine quality, warm natural light, shallow depth of field.",
    "Composition centered, copy-space on one side for marketing overlay.",
    "Do NOT add any text, watermarks, logos or letters in the image."
  ].join(" ");

  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt: finalPrompt,
      size,
      n: 1,
      quality: "high"
    })
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`OpenAI images ${resp.status}: ${body.slice(0, 240)}`);
  }
  const j = await resp.json();
  const b64 = j?.data?.[0]?.b64_json as string | undefined;
  if (!b64) throw new Error("OpenAI no devolvió imagen");
  return { pngBase64: b64 };
}
