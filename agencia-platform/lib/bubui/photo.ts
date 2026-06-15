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
 * Image-to-image con OpenAI /v1/images/edits (gpt-image-2, con gpt-image-1 de
 * respaldo): MEJORA la foto real (iluminación, limpieza, nitidez, color) SIN
 * recrear la escena, y le compone el NOMBRE del comercio. A diferencia del
 * generador de hero por texto, aquí SÍ queremos texto en la imagen (los
 * modelos gpt-image rinden bien con tipografía), pero solo el nombre.
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
  // Prompt de RETOQUE (no recreación). La clave para que respete la foto real
  // es, además, `input_fidelity: "high"` en la llamada (ver buildForm). Aquí
  // insistimos en conservar la escena y solo mejorarla + rotular el nombre.
  const prompt = [
    `This is a real photo of a local business. Enhance and retouch THIS SAME photo — do NOT replace, redraw, reimagine or generate a new scene.`,
    `Keep the exact same place, objects, layout, perspective and framing as the original. It must still look like the same real photograph, just professionally edited.`,
    `Improvements only: balance and improve the lighting, lift dark shadows, fix white balance and make colors natural and vivid, increase sharpness and clarity, reduce noise/blur, and clean up small clutter, dust or distractions. Real-estate / magazine retouch quality.`,
    `Then overlay ONLY the business name "${name}" as a headline, large, clean, elegant modern sans-serif, perfectly legible, with a subtle shadow or a soft translucent scrim behind the text so it reads well over the photo. Spell it EXACTLY as written, no typos.`,
    `Do NOT add any other text, subtitle, category, slogan, logo, watermark, QR code or graphics. Photorealistic result, horizontal 16:9 composition.`
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
  const buildForm = (model: string) => {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", "1536x1024");
    form.append("quality", "high");
    // Clave para MEJORAR la foto en vez de recrearla: máxima fidelidad a la
    // imagen de entrada (conserva escena, objetos y composición reales). El
    // parámetro está soportado en gpt-image-1; en gpt-image-2 no lo enviamos
    // (igual que el calendario editorial) para no arriesgar un 400.
    if (model === "gpt-image-1") form.append("input_fidelity", "high");
    form.append("n", "1");
    form.append("image", new Blob([new Uint8Array(inputBuf)], { type: inputType }), `escaparate.${ext}`);
    return form;
  };

  // gpt-image-2 es el modelo principal (mejor calidad, el mismo que usa el
  // calendario editorial IA). gpt-image-1 queda de respaldo por si la cuenta
  // no tuviera acceso a gpt-image-2.
  const MODELS = ["gpt-image-2", "gpt-image-1"];
  let resp: Response | null = null;
  let lastErr = "";
  outer: for (const model of MODELS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: buildForm(model),
        signal: AbortSignal.timeout(180000)
      });
      if (r.ok) { resp = r; break outer; }
      lastErr = `OpenAI images/edits ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`;
      // Modelo desconocido para esta cuenta → prueba el siguiente modelo.
      if (r.status < 500 && /model/i.test(lastErr) && model !== MODELS[MODELS.length - 1]) continue outer;
      if (r.status < 500 || attempt === 3) throw new Error(lastErr);
      await new Promise((res) => setTimeout(res, attempt === 1 ? 4000 : 10000));
    }
  }
  if (!resp) throw new Error(lastErr || "OpenAI images/edits sin respuesta.");
  const j = await resp.json();
  const b64 = j?.data?.[0]?.b64_json as string | undefined;
  if (!b64) throw new Error("OpenAI no devolvió imagen");
  return { pngBase64: b64 };
}
