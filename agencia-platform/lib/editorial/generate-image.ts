/**
 * Generación de imagen para una publicación con gpt-image-1 (OpenAI).
 * Migra "generar-imagen-publicacion" del plugin (versión simplificada sin
 * overlay todavía).
 *
 * Decisiones:
 * - Modelo: gpt-image-1 (sucesor de DALL-E 3, soporta tamaños 1024x1024,
 *   1024x1536, 1536x1024).
 * - El cliente puede tener dimensionesByFormat custom; mapeamos al tamaño
 *   soportado por OpenAI más cercano.
 * - La imagen se sube a R2 y se persiste como thumbnail + mediaUrls.
 */

import { prisma } from "@/lib/db/prisma";
import { getOpenAiKeyForWorkspace } from "@/lib/ai/openai";
import { generateFreepikImage, pickFreepikSize } from "@/lib/ai/freepik";
import { isStorageEnabled, uploadBuffer, signedDownloadUrl, buildS3Key } from "@/lib/storage/r2";
import { logAiUsage } from "@/lib/ai/usage";
import type { DimensionsByFormat, EditorialFormat } from "@/lib/editorial/client-meta";
import { defaultDimensionsByFormat } from "@/lib/editorial/client-meta";

type Size = "1024x1024" | "1024x1536" | "1536x1024";

/**
 * Mapea un (w, h) custom al tamaño soportado por gpt-image-1 más parecido
 * en aspect ratio.
 */
/**
 * Llama a OpenAI /v1/images/edits con reference images. Equivale al
 * camino "image-to-image" del plugin (gpt-image-2 con multipart).
 * Multiples refs vía campo image[]; single ref vía campo image.
 */
async function openaiImagesEdits(opts: {
  apiKey: string;
  prompt: string;
  size: string;
  quality: "low" | "medium" | "high";
  referenceUrls: string[];
}): Promise<Buffer> {
  const t0 = Date.now();
  // Descargamos cada ref en paralelo (antes era secuencial — añadía 4-8s
  // por imagen). Con AbortSignal de 15s para no quedarnos colgados.
  const refResults = await Promise.all(
    opts.referenceUrls.map(async (url, i) => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return null;
        const ab = await r.arrayBuffer();
        const ct = (r.headers.get("content-type") ?? "image/png").split(";")[0].trim();
        const ext = ct === "image/jpeg" ? "jpg" : ct === "image/webp" ? "webp" : "png";
        return { idx: i, ab, ct, ext };
      } catch {
        return null;
      }
    })
  );
  const t1 = Date.now();
  console.log(`[openaiImagesEdits] refs descargadas: ${refResults.filter(Boolean).length}/${opts.referenceUrls.length} en ${t1 - t0}ms`);

  const formData = new FormData();
  formData.append("model", "gpt-image-2");
  formData.append("prompt", opts.prompt);
  formData.append("size", opts.size);
  formData.append("quality", opts.quality);
  formData.append("n", "1");
  const fieldName = opts.referenceUrls.length > 1 ? "image[]" : "image";
  let added = 0;
  for (const r of refResults) {
    if (!r) continue;
    formData.append(fieldName, new Blob([r.ab], { type: r.ct }), `ref-${r.idx}.${r.ext}`);
    added++;
  }
  if (added === 0) {
    throw new Error("Ninguna referencia se pudo descargar. Comprueba que las URLs de las refs visuales son accesibles.");
  }

  const resp = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body: formData,
    // Sin AbortSignal: puede tardar hasta 180s con refs y quality alta
    signal: AbortSignal.timeout(180000)
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OpenAI Images Edits ${resp.status}: ${txt.slice(0, 400)}`);
  }
  const data = await resp.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI /edits no devolvió b64_json");
  return Buffer.from(b64, "base64");
}

export function pickOpenAiSize(width: number, height: number): Size {
  const r = width / height;
  if (r > 1.2) return "1536x1024"; // landscape
  if (r < 0.83) return "1024x1536"; // portrait
  return "1024x1024"; // square-ish
}

export type GenerateImageOptions = {
  workspaceId: string;
  userId?: string | null;
  postId: string;
  quality?: "low" | "medium" | "high"; // mapea a gpt-image-1 quality
  promptOverride?: string; // si se quiere ignorar el copy y usar prompt libre
  format?: EditorialFormat; // si se quiere forzar un formato distinto del post
};

export async function generateImageForPost(opts: GenerateImageOptions): Promise<{
  url: string;
  s3Key: string;
  prompt: string;
  size: Size;
}> {
  if (!isStorageEnabled()) {
    throw new Error("Storage no configurado. Configura STORAGE_* en env para guardar imágenes generadas.");
  }

  const post = await prisma.editorialPost.findFirst({
    where: { id: opts.postId, workspaceId: opts.workspaceId },
    include: { client: true }
  });
  if (!post) throw new Error("Publicación no encontrada");

  const client = post.client;
  const format = (opts.format ?? (post.format as EditorialFormat) ?? "imagen") as EditorialFormat;
  const dims = (client?.dimensionsByFormat as DimensionsByFormat | null) ?? defaultDimensionsByFormat();
  const dim = dims[format] ?? dims.imagen;
  const size = pickOpenAiSize(dim.width, dim.height);

  // Build prompt. Si el post ya tiene un imagePrompt estructurado generado
  // por Claude (a través de generate-month), lo usamos directamente porque
  // ya contiene la descripción física de personas del roster, espacio
  // negativo y la instrucción "no readable text". Si no, construimos uno
  // mínimo a partir del copy.
  const storedImagePrompt = (post as any).imagePrompt as string | null;

  let prompt: string;
  if (opts.promptOverride?.trim()) {
    prompt = opts.promptOverride.trim();
  } else if (storedImagePrompt && storedImagePrompt.length > 50) {
    prompt = storedImagePrompt;
  } else {
    // Fallback: prompt construido en runtime (peor calidad)
    const brandColors = client
      ? `Brand colors: primary ${client.brandColorPrimary}, accent ${client.brandColorAccent}.`
      : "";
    const guide = client?.styleGuideCached?.trim()
      ? `Brand style guide: ${client.styleGuideCached.slice(0, 1200)}`
      : "";
    const brief = client?.brandBrief?.trim() ? `About the brand: ${client.brandBrief}.` : "";
    const userCopy = post.content?.trim()
      ? `Topic of the post: ${post.content.slice(0, 300)}`
      : "";
    prompt = [
      `Photo for a social media post about "${post.title}".`,
      brief,
      brandColors,
      guide,
      userCopy,
      `Editorial photographic realism. Composition with ample empty negative space at the bottom for text overlay.`,
      `CRITICAL: no readable text, no letters, no numbers, no watermarks, no signs of any kind — text is composed separately afterwards.`
    ]
      .filter(Boolean)
      .join("\n");
  }

  const quality = opts.quality ?? "medium";

  // Resolución del proveedor: cliente → workspace → openai
  const ws = await prisma.workspace.findUnique({ where: { id: opts.workspaceId } });
  const wsImageModel: string | null = (ws?.settings as any)?.editorial?.imageModel ?? null;
  const provider: "openai" | "freepik" =
    (client?.imageModel ?? wsImageModel ?? "openai-gpt-image-1").startsWith("freepik")
      ? "freepik"
      : "openai";

  // Detectar personas del roster mencionadas en este post para pasar
  // sus fotos como reference_images a gpt-image-2 vía /v1/images/edits.
  // Esto es lo que hacía el plugin original y por lo que las caras
  // salían como personas reales y no genéricas.
  const refs: any[] = Array.isArray(client?.referenceImages) ? client.referenceImages : [];
  const peopleRefs = new Map<string, string[]>(); // personName → urls
  for (const r of refs) {
    const name = (r?.personName ?? "").toString().trim();
    const url = typeof r?.url === "string" ? r.url : null;
    if (!name || !url) continue;
    if (!peopleRefs.has(name)) peopleRefs.set(name, []);
    peopleRefs.get(name)!.push(url);
  }
  const haystack = `${post.title} ${post.content ?? ""}`.toLowerCase();
  const referenceUrls: string[] = [];
  for (const [name, urls] of peopleRefs.entries()) {
    if (haystack.includes(name.toLowerCase())) {
      // Máximo 2 fotos por persona, total 4. Más refs hace que
      // OpenAI gpt-image-2 tarde MUCHÍSIMO (5+ min) y alucine
      // composiciones de varios cuerpos. Para una sola persona,
      // 2 fotos angle-frontal/perfil son suficientes para fijar
      // identidad.
      for (const u of urls.slice(0, 2)) {
        if (referenceUrls.length < 4) referenceUrls.push(u);
      }
    }
  }

  let buf: Buffer;
  let modelLabel: string;
  if (provider === "freepik") {
    buf = await generateFreepikImage({
      workspaceId: opts.workspaceId,
      prompt,
      size: pickFreepikSize(dim.width, dim.height)
    });
    modelLabel = "freepik-seedream-v4";
  } else if (referenceUrls.length > 0) {
    // PATH IMAGES/EDITS con reference images (gpt-image-2). Replica el plugin.
    const apiKey = await getOpenAiKeyForWorkspace(opts.workspaceId);
    buf = await openaiImagesEdits({
      apiKey,
      prompt,
      size,
      quality,
      referenceUrls
    });
    modelLabel = `gpt-image-2-edits-${quality}-refs${referenceUrls.length}`;
  } else {
    const apiKey = await getOpenAiKeyForWorkspace(opts.workspaceId);
    const resp = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        n: 1,
        size,
        quality,
        output_format: "png"
      })
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`OpenAI Image ${resp.status}: ${txt.slice(0, 300)}`);
    }
    const data = await resp.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI no devolvió imagen en b64_json");
    buf = Buffer.from(b64, "base64");
    modelLabel = `gpt-image-1-${quality}`;
  }

  // Auto-aplicar overlay con headlineLines + logo + frame. gpt-image-1 NO
  // sabe escribir texto en español sin alucinar — siempre componemos
  // nosotros encima con sharp+SVG.
  let finalBuf: Buffer = buf;
  try {
    const headlines = (post as any).headlineLines as any[] | null;
    const placement = ((post as any).textPlacement as string | null) ?? "bottom";
    if (Array.isArray(headlines) && headlines.length > 0) {
      const { composeOverlayStructured } = await import("./overlay");
      const clientFonts = Array.isArray(client?.fonts) ? (client?.fonts as any[]) : [];
      finalBuf = await composeOverlayStructured({
        baseBuffer: buf,
        headlines,
        textPlacement: placement as "top" | "center" | "bottom",
        logoUrl: client?.logoUrl ?? null,
        logoPosition: (client?.logoPosition as any) ?? "br",
        primary: client?.brandColorPrimary,
        accent: client?.brandColorAccent,
        text: client?.brandColorText,
        pattern: (client?.visualPattern as any) ?? "clean",
        clientFonts: clientFonts.length > 0 ? (clientFonts as any) : undefined
      });
    }
  } catch (e) {
    // Si falla el overlay, mantenemos la imagen base sin texto.
    console.error("[generate-image] overlay failed, keeping base image:", e);
  }

  // Subir a R2
  const s3Key = buildS3Key({
    workspaceId: opts.workspaceId,
    targetType: "editorial",
    targetId: post.id,
    filename: `gen-${Date.now()}.png`
  });
  await uploadBuffer({ s3Key, body: finalBuf, contentType: "image/png" });
  const url = await signedDownloadUrl(s3Key);

  // Actualizar post: thumbnail + push a mediaUrls
  let mediaUrls: string[] = [];
  try {
    mediaUrls = JSON.parse(post.mediaUrls);
    if (!Array.isArray(mediaUrls)) mediaUrls = [];
  } catch {
    mediaUrls = [];
  }
  if (!mediaUrls.includes(url)) mediaUrls.unshift(url);

  await prisma.editorialPost.update({
    where: { id: post.id },
    data: { thumbnail: url, mediaUrls: JSON.stringify(mediaUrls) }
  });

  // Coste estimado para tracking
  const approxCost =
    provider === "freepik" ? 1 : quality === "high" ? 17 : quality === "low" ? 2 : 4;
  await logAiUsage({
    workspaceId: opts.workspaceId,
    userId: opts.userId ?? null,
    projectId: null,
    feature: "editorial_generate_image",
    provider,
    model: modelLabel,
    inputTokens: prompt.length,
    outputTokens: approxCost // hack: coste estimado en céntimos
  }).catch(() => {});

  return { url, s3Key, prompt, size };
}
