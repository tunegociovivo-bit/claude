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
import { defaultDimensionsByFormat, visualPatternHint } from "@/lib/editorial/client-meta";

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

  const t2 = Date.now();
  console.log(`[openaiImagesEdits] enviando ${added} refs a OpenAI gpt-image-2, quality=${opts.quality}, size=${opts.size}`);
  const resp = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body: formData,
    // Hasta 180s — gpt-image-2 con 5 refs medium suele tardar 60-120s.
    signal: AbortSignal.timeout(180000)
  });
  const t3 = Date.now();
  console.log(`[openaiImagesEdits] OpenAI respondió en ${((t3 - t2) / 1000).toFixed(1)}s con status ${resp.status} (total con refs: ${((t3 - t0) / 1000).toFixed(1)}s)`);
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
  // Umbrales agresivos hacia square: gpt-image-2 con 1024x1536 o
  // 1536x1024 tarda 50-100% más que con 1024x1024 (50% más píxeles).
  // El plugin original usaba siempre 1024x1024 por esta razón.
  // Para Instagram Feed 4:5 (ratio 0.8) preferimos square por
  // velocidad — el overlay no se ve afectado y la imagen sirve igual.
  // Sólo elegimos portrait/landscape para aspectos extremos (reels,
  // YouTube landscape, etc.).
  if (r > 1.5) return "1536x1024"; // landscape (16:9, 1.91:1)
  if (r < 0.7) return "1024x1536"; // portrait (9:16 reels/stories)
  return "1024x1024"; // square por defecto (incl. 4:5 Feed)
}

export type GenerateImageOptions = {
  workspaceId: string;
  userId?: string | null;
  postId: string;
  quality?: "low" | "medium" | "high"; // mapea a gpt-image-1 quality
  promptOverride?: string; // si se quiere ignorar el copy y usar prompt libre
  format?: EditorialFormat; // si se quiere forzar un formato distinto del post
  /** Override del auto-detect de personas: lista de nombres del roster
   *  que SÍ deben aparecer (refs forzadas, ignorando si están mencionadas
   *  o no en el copy). */
  forceRosterPersons?: string[];
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

  // Patrón visual + intensidad (%). El post puede sobreescribir el patrón
  // por defecto del cliente para esta publicación concreta. La intensidad
  // (0-100) modula cuánto pesa el estilo en el prompt de la IA:
  //   0      → no inyectamos nada (foto editorial neutra).
  //   1-39   → "subtle hint of" el estilo.
  //   40-74  → aplica el estilo con normalidad.
  //   75-100 → "strongly / boldly" el estilo (replicación marcada).
  const effectivePattern =
    ((post as any).visualPattern as string | null) ?? (client?.visualPattern as string | null) ?? "clean";
  const rawStrength = (post as any).patternStrength as number | null;
  const patternStrength =
    typeof rawStrength === "number" ? Math.max(0, Math.min(100, Math.round(rawStrength))) : 50;

  // Plantilla visual elegida para esta publicación (si la hay). Es una
  // imagen subida por el cliente que se usa como guía de estilo/layout.
  const templateId = (post as any).patternTemplateId as string | null;
  const clientTemplates: any[] = Array.isArray((client as any)?.patternTemplates)
    ? ((client as any).patternTemplates as any[])
    : [];
  const selectedTemplate =
    templateId && typeof templateId === "string"
      ? clientTemplates.find((t) => t?.id === templateId) ?? null
      : null;
  const templateUrl: string | null =
    selectedTemplate && typeof selectedTemplate.url === "string" ? selectedTemplate.url : null;

  const intensityWord = (label: string) =>
    patternStrength >= 75
      ? `Strongly and boldly apply ${label} (high fidelity, ${patternStrength}% intensity)`
      : patternStrength < 40
      ? `Subtle hint of ${label} (light touch, ${patternStrength}% intensity)`
      : `Apply ${label} (${patternStrength}% intensity)`;

  if (templateUrl && patternStrength > 0) {
    // Si hay plantilla, ESA es la guía principal de estilo. La imagen se
    // añade más abajo a referenceUrls; aquí inyectamos la instrucción.
    const notes =
      selectedTemplate?.notes && typeof selectedTemplate.notes === "string" ? ` Notes: ${selectedTemplate.notes}.` : "";
    prompt = `${prompt}\nVISUAL TEMPLATE: ${intensityWord(
      "the visual style, layout, composition and color treatment of the provided TEMPLATE reference image"
    )}. Use the template only as a STYLE/LAYOUT guide — do NOT copy its specific subject or any text in it.${notes}`;
  } else if (patternStrength > 0) {
    // Sin plantilla: usamos el patrón predefinido (promptHint de texto).
    const hint = visualPatternHint(effectivePattern);
    prompt = `${prompt}\nVISUAL STYLE: ${intensityWord("this visual style")}: ${hint}.`;
  }

  const quality = opts.quality ?? "medium";

  // Resolución del proveedor: cliente → workspace → openai
  const ws = await prisma.workspace.findUnique({ where: { id: opts.workspaceId } });
  const wsImageModel: string | null = (ws?.settings as any)?.editorial?.imageModel ?? null;
  const provider: "openai" | "freepik" =
    (client?.imageModel ?? wsImageModel ?? "openai-gpt-image-1").startsWith("freepik")
      ? "freepik"
      : "openai";

  // Detectar personas del roster que deben aparecer en la imagen.
  // Reglas (en orden de prioridad):
  //   1) Si el usuario fuerza una lista explícita (forceRosterPersons,
  //      desde el modal), se usa esa lista tal cual.
  //   2) Si el copy menciona un nombre concreto del roster → esa persona.
  //   3) Si el copy menciona "equipo", "team", "nuestro equipo", etc.
  //      → incluimos a TODAS las personas del roster cuyo type = "equipo".
  //      Esto cubre el caso "Rochar y su equipo" donde sólo Rochar
  //      matchea por nombre pero queremos también a Ana, Dra Angie, etc.
  //   4) Si el copy menciona persona destacada + colectivo → añadimos
  //      la persona destacada Y todo el equipo.
  const refs: any[] = Array.isArray(client?.referenceImages) ? client.referenceImages : [];
  // Indexamos por nombre con metadata de type (necesario para el matching
  // por colectivos).
  type PersonInfo = { name: string; type: string; urls: string[] };
  const peopleByName = new Map<string, PersonInfo>();
  for (const r of refs) {
    const name = (r?.personName ?? "").toString().trim();
    const url = typeof r?.url === "string" ? r.url : null;
    const type = (r?.type ?? "general").toString();
    if (!name || !url) continue;
    if (!peopleByName.has(name)) peopleByName.set(name, { name, type, urls: [] });
    peopleByName.get(name)!.urls.push(url);
  }

  const haystack = `${post.title} ${post.content ?? ""}`.toLowerCase();
  const collectiveRegex = /\b(equipo|team|nuestro equipo|su equipo|todo el equipo|todos|nosotras|nosotros|profesionales|doctoras|doctores|nurses|enfermeras|enfermeros)\b/;
  const mentionsCollective = collectiveRegex.test(haystack);

  // Conjunto final de personas a incluir.
  const includedNames = new Set<string>();
  const forced = (opts.forceRosterPersons ?? []).map((n) => n.toLowerCase().trim()).filter(Boolean);
  if (forced.length > 0) {
    // Modo "lista forzada" desde el modal: sólo estas personas.
    for (const p of peopleByName.values()) {
      if (forced.includes(p.name.toLowerCase())) includedNames.add(p.name);
    }
  } else {
    // Modo auto-detect.
    for (const p of peopleByName.values()) {
      if (haystack.includes(p.name.toLowerCase())) {
        includedNames.add(p.name);
      }
    }
    // Si el copy habla del "equipo", añadimos a TODOS los de type=equipo.
    if (mentionsCollective) {
      for (const p of peopleByName.values()) {
        if (p.type === "equipo") includedNames.add(p.name);
      }
    }
  }

  // Construir referenceUrls. Cap total = 5 (compromiso entre fidelidad
  // de identidad y latencia de OpenAI /edits — cada ref añade ~15-25s).
  // Distribución:
  //   1 persona  → 2 refs
  //   2 personas → 4 refs (2+2)
  //   3 personas → 5 refs (2+2+1)
  //   4+ personas → 5 refs (1+1+1+1+1, prioriza diversidad de caras)
  const names = Array.from(includedNames);
  const TOTAL_CAP = 5;
  const perPerson = names.length >= 4 ? 1 : 2;
  const referenceUrls: string[] = [];
  // La plantilla visual (si la hay y su intensidad > 0) ocupa el primer
  // slot: es la guía de estilo y queremos asegurar que la IA la reciba.
  if (templateUrl && patternStrength > 0) referenceUrls.push(templateUrl);
  for (const name of names) {
    const info = peopleByName.get(name);
    if (!info) continue;
    for (const u of info.urls.slice(0, perPerson)) {
      if (referenceUrls.length < TOTAL_CAP) referenceUrls.push(u);
    }
  }

  // Log diagnóstico: qué personas detectamos y por qué. Visible en
  // Railway logs (kind=info). Permite saber si el matching falla por
  // texto, por regex, o por refs ausentes.
  console.log("[generate-image] roster decision:", JSON.stringify({
    postId: post.id,
    haystackPreview: haystack.slice(0, 200),
    mentionsCollective,
    forcedFromModal: forced,
    peopleInRoster: Array.from(peopleByName.values()).map((p) => ({ name: p.name, type: p.type, photos: p.urls.length })),
    includedPersons: Array.from(includedNames),
    finalRefCount: referenceUrls.length
  }));

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
        pattern: effectivePattern as any,
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
