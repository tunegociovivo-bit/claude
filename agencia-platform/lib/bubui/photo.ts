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

/**
 * Resuelve la API key de OpenAI como el resto del Hub:
 *   1. process.env.OPENAI_API_KEY
 *   2. Workspace.settings.ai.openaiApiKey (cifrada, bóveda del Hub —
 *      es donde están las claves en producción).
 */
async function resolveOpenAiKey(): Promise<string | null> {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const { prisma } = await import("@/lib/db/prisma");
    const ws = await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!ws) return null;
    const { getOpenAiKeyForWorkspace } = await import("@/lib/ai/openai");
    return await getOpenAiKeyForWorkspace(ws.id);
  } catch {
    return null;
  }
}

/** Como isPhotoAiEnabled, pero mirando también la bóveda del Hub. */
export async function isPhotoAiEnabledAsync(): Promise<boolean> {
  return Boolean(await resolveOpenAiKey());
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
  const apiKey = await resolveOpenAiKey();
  if (!apiKey) throw new Error("API key de OpenAI no configurada (ni env ni bóveda del Hub)");

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

/**
 * Banner IA a partir de la FOTO DEL ESCAPARATE del negocio.
 *
 * Image-to-image con OpenAI /v1/images/edits (gpt-image-2): mejora la foto
 * real y le compone el NOMBRE del comercio en el centro. A diferencia del
 * generador de hero por texto, aquí SÍ queremos texto en la imagen (gpt-image-2
 * rinde bien con tipografía), pero solo el nombre del negocio.
 *
 * Devuelve un PNG en base64.
 */
export async function generateBusinessBanner(opts: {
  businessName: string;
  category: string;
  /** Foto del escaparate subida por el dueño. */
  imageBuffer: Buffer;
  mimeType: string;
}): Promise<{ pngBase64: string }> {
  const apiKey = await resolveOpenAiKey();
  if (!apiKey) throw new Error("API key de OpenAI no configurada (ni env ni bóveda del Hub)");

  const name = opts.businessName.trim().slice(0, 60);
  // Prompt curado (versión mejorada del orientativo del cliente). En inglés
  // para mayor fidelidad del modelo, con el nombre EXACTO entre comillas.
  const prompt = [
    `Turn the attached photo of this local business storefront into a polished, professional promotional banner for the "Bubui" app (a local-deals app).`,
    `Keep the real storefront clearly recognizable, but enhance it: tidy up clutter, improve lighting and colors, make it crisp, vivid, warm and inviting, advertising/magazine quality.`,
    `Add the business name "${name}" as the main headline, centered, large and highly legible, with elegant modern sans-serif typography and strong contrast (use a subtle shadow, gradient scrim or translucent banner behind the text so it reads perfectly over the photo).`,
    `Spell the name EXACTLY as written, with no typos.`,
    `You may add a small tasteful subtitle "${opts.category}" beneath the name, but keep it minimal.`,
    `Horizontal 16:9 banner composition. No watermarks, no QR codes, no invented logos, no extra or gibberish text — ONLY the business name and the optional category.`
  ].join(" ");

  // Reducimos la imagen de entrada (la foto del móvil puede pesar varios MB)
  // para evitar límites de tamaño y acelerar. Salida JPEG ligera.
  let inputBuf = opts.imageBuffer;
  let inputType = opts.mimeType || "image/png";
  try {
    const sharp = (await import("sharp")).default;
    inputBuf = await sharp(opts.imageBuffer)
      .rotate()
      .resize({ width: 1536, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    inputType = "image/jpeg";
  } catch {
    // Si sharp falla, enviamos el original.
  }

  const ext = inputType === "image/jpeg" ? "jpg" : inputType === "image/webp" ? "webp" : "png";
  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("prompt", prompt);
  form.append("size", "1536x1024");
  form.append("quality", "high");
  form.append("n", "1");
  form.append("image", new Blob([new Uint8Array(inputBuf)], { type: inputType }), `escaparate.${ext}`);

  let resp: Response | null = null;
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(180000)
    });
    if (r.ok) { resp = r; break; }
    if (r.status < 500 || attempt === 3) {
      lastErr = (await r.text().catch(() => "")).slice(0, 300);
      throw new Error(`OpenAI images/edits ${r.status}: ${lastErr}`);
    }
    await new Promise((res) => setTimeout(res, attempt === 1 ? 4000 : 10000));
  }
  if (!resp) throw new Error(`OpenAI images/edits sin respuesta. ${lastErr}`);
  const j = await resp.json();
  const b64 = j?.data?.[0]?.b64_json as string | undefined;
  if (!b64) throw new Error("OpenAI no devolvió imagen");
  return { pngBase64: b64 };
}
