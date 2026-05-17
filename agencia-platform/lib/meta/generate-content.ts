/**
 * Fase 2 de Campaña Redes IA — generación automática de copy + imágenes
 * para cada anuncio de la campaña.
 *
 * Pipeline:
 *   1) expandSegmentation(): Claude lee el briefing + segmentación libre
 *      del user y devuelve un JSON estructurado con edades, intereses
 *      ("interest_keywords" para Meta), comportamientos sugeridos,
 *      tono recomendado y hashtags clave. Se guarda en
 *      campaign.expandedSegmentation.
 *
 *   2) generateCopyForAd(): por cada anuncio, Claude produce
 *      headline + primaryText + description + call-to-action +
 *      imagePrompt (descripción visual rica en inglés para el
 *      generador de imagen).
 *
 *   3) generateImageForAd(): OpenAI gpt-image-1 (texto-a-imagen) con
 *      el imagePrompt. La imagen se sube a R2 y la URL pública se
 *      guarda en MetaAd.mediaUrls.
 *
 * Vídeos NO se generan (el user los sube manualmente). Para los
 * anuncios VIDEO solo se genera copy.
 *
 * Para CAROUSEL: se generan N tarjetas (default 3). Cada tarjeta es
 * una imagen + copy corto. Por simplicidad de Fase 2, generamos 3
 * imágenes que comparten primaryText y cada una tiene su headline.
 *
 * Estado:
 *   PLACEHOLDER → GENERATING → READY_FOR_REVIEW (éxito)
 *                          → FAILED + lastError (fallo)
 *
 * Tras procesar todos los anuncios: campaign.status = PENDING_REVIEW
 * para que el user revise y apruebe.
 */

import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/ai/anthropic";
import { getOpenAiKeyForWorkspace } from "@/lib/ai/openai";
import { buildS3Key, isStorageEnabled, signedDownloadUrl, uploadBuffer } from "@/lib/storage/r2";
import { logAiUsage } from "@/lib/ai/usage";

// Modelo de imagen de OpenAI. Probamos primero "gpt-image-2" (el más
// reciente, mejor composición y prompt-following) y si la API
// devuelve 400 model_not_found caemos a "gpt-image-1". Así si OpenAI
// retira / renombra el modelo, no se rompe la plataforma.
const IMAGE_MODEL_PRIMARY = "gpt-image-2";
const IMAGE_MODEL_FALLBACK = "gpt-image-1";
const CAROUSEL_CARDS = 3;          // tarjetas por carrusel
const PARALLEL_IMAGE_GENS = 2;     // concurrencia para no saturar OpenAI

// ─────────────────────────────────────────────────────────────────────
// Segmentación expandida
// ─────────────────────────────────────────────────────────────────────

type ExpandedSegmentation = {
  ageMin: number;
  ageMax: number;
  genders: ("MALE" | "FEMALE" | "ALL")[];
  interests: string[];
  behaviors: string[];
  excludedInterests: string[];
  recommendedTone: string;
  suggestedHashtags: string[];
  audienceSizeEstimate: string;
};

const SEG_SCHEMA = {
  type: "object",
  properties: {
    ageMin: { type: "integer", minimum: 13, maximum: 65 },
    ageMax: { type: "integer", minimum: 13, maximum: 65 },
    genders: {
      type: "array",
      items: { type: "string", enum: ["MALE", "FEMALE", "ALL"] }
    },
    interests: { type: "array", items: { type: "string" } },
    behaviors: { type: "array", items: { type: "string" } },
    excludedInterests: { type: "array", items: { type: "string" } },
    recommendedTone: { type: "string" },
    suggestedHashtags: { type: "array", items: { type: "string" } },
    audienceSizeEstimate: { type: "string" }
  },
  required: ["ageMin", "ageMax", "genders", "interests", "behaviors", "excludedInterests", "recommendedTone", "suggestedHashtags", "audienceSizeEstimate"]
};

export async function expandSegmentation(opts: {
  workspaceId: string;
  briefing: string;
  segmentationRaw: string;
  locationsIncluded: string[];
  locationsExcluded: string[];
}): Promise<ExpandedSegmentation> {
  const system =
    "Eres un experto en campañas publicitarias en Meta Ads (Facebook/Instagram). " +
    "Tu tarea es leer la descripción del público objetivo de una campaña y devolver " +
    "una estructura de segmentación lista para Meta API, con intereses concretos " +
    "(los que aparecen en el catálogo de Meta), comportamientos, rangos de edad y " +
    "género realistas, y recomendaciones de tono y hashtags. Sé específico — los " +
    "intereses deben ser sustantivos concretos (\"BMW\", \"perros pequeños\", " +
    "\"yoga\"), no genéricos (\"deporte\"). En audienceSizeEstimate da una " +
    "estimación cualitativa (pequeño/medio/grande).";

  const user = `Briefing de la campaña:
${opts.briefing || "(sin briefing adicional)"}

Segmentación libre escrita por el user:
${opts.segmentationRaw}

Ubicaciones incluidas: ${opts.locationsIncluded.join(", ") || "Toda España"}
Ubicaciones excluidas: ${opts.locationsExcluded.join(", ") || "ninguna"}

Devuelve el JSON con la segmentación expandida.`;

  const result = await completeJson<ExpandedSegmentation>({
    workspaceId: opts.workspaceId,
    system,
    user,
    schema: SEG_SCHEMA,
    maxTokens: 1500
  });
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Copy por anuncio
// ─────────────────────────────────────────────────────────────────────

type AdCopy = {
  headline: string;       // titular corto (40 chars)
  primaryText: string;    // texto principal (90 chars típico)
  description: string;    // descripción 30 chars
  callToAction: string;   // "LEARN_MORE" | "SIGN_UP" | "GET_QUOTE"...
  imagePrompt: string;    // descripción visual rica EN INGLÉS para gpt-image
  altImageVariations?: string[]; // (solo carruseles) headlines extra por tarjeta
};

const COPY_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", maxLength: 60 },
    primaryText: { type: "string", maxLength: 200 },
    description: { type: "string", maxLength: 40 },
    callToAction: { type: "string" },
    imagePrompt: { type: "string" },
    altImageVariations: { type: "array", items: { type: "string" } }
  },
  required: ["headline", "primaryText", "description", "callToAction", "imagePrompt"]
};

const CTAS_BY_OBJECTIVE: Record<string, string[]> = {
  LEADS: ["SIGN_UP", "GET_QUOTE", "LEARN_MORE", "CONTACT_US", "APPLY_NOW"],
  TRAFFIC: ["LEARN_MORE", "SEE_MORE", "SHOP_NOW", "BOOK_TRAVEL"],
  ENGAGEMENT: ["LEARN_MORE", "LIKE_PAGE"],
  CONVERSIONS: ["SHOP_NOW", "GET_OFFER", "ORDER_NOW", "SIGN_UP"],
  AWARENESS: ["LEARN_MORE"],
  SALES: ["SHOP_NOW", "GET_OFFER", "ORDER_NOW"],
  APP_PROMOTION: ["INSTALL_NOW", "USE_APP"],
  VIDEO_VIEWS: ["WATCH_MORE", "LEARN_MORE"],
  REACH: ["LEARN_MORE"]
};

export async function generateCopyForAd(opts: {
  workspaceId: string;
  campaignName: string;
  briefing: string;
  objective: string;
  fanpageName?: string | null;
  segmentation: string;
  audienceBrief?: string | null;
  adsetLabel: string;
  format: "IMAGE" | "CAROUSEL" | "VIDEO";
  adIndex: number;
  totalAdsInSet: number;
}): Promise<AdCopy> {
  const validCtas = (CTAS_BY_OBJECTIVE[opts.objective] ?? ["LEARN_MORE"]).join(", ");
  const formatHint = {
    IMAGE: "anuncio de imagen única (1 foto + copy)",
    CAROUSEL: `anuncio en carrusel (${CAROUSEL_CARDS} tarjetas — devuelve ${CAROUSEL_CARDS - 1} variaciones extra de headline en altImageVariations)`,
    VIDEO: "anuncio en vídeo (el vídeo lo subimos a mano — devuelve solo el copy)"
  }[opts.format];

  const system =
    "Eres un creativo publicitario senior de campañas Meta (Facebook/Instagram). " +
    "Escribes copys en castellano que CONVIERTEN: titular gancho (40 chars), texto " +
    "principal que aporta valor o crea urgencia (90-150 chars), descripción corta, " +
    "y una llamada a la acción del catálogo Meta apropiada al objetivo.\n\n" +
    "MUY IMPORTANTE — el imagePrompt EN INGLÉS:\n" +
    "Generas un prompt EXTREMADAMENTE detallado para un generador de imagen tipo " +
    "gpt-image que tiene que producir un CREATIVO PUBLICITARIO de alta calidad, " +
    "no una foto stock. Estructura recomendada:\n" +
    "  1) Subject: protagonista concreto (persona con descripción física + " +
    "     emoción + acción, o producto en uso real).\n" +
    "  2) Scene: dónde, cuándo, ambiente, props.\n" +
    "  3) Composition: punto focal único, rule of thirds, ángulo (low/eye/" +
    "     high), distancia (close-up / medium / wide).\n" +
    "  4) Lighting: golden hour, dramatic rim light, studio softbox, hard " +
    "     contrast — sé específico, NO digas 'natural light'.\n" +
    "  5) Color palette: 2-3 colores dominantes saturados.\n" +
    "  6) Style cue: 'editorial fashion photography', 'commercial advertising " +
    "     photography', 'cinematic 35mm look', etc. — NUNCA 'stock photo'.\n" +
    "  7) Negative space: indica explícitamente dónde queda espacio limpio " +
    "     para overlay de texto (bottom third para Feed, top+bottom thirds " +
    "     para Stories).\n" +
    "Variedad por anuncio del mismo conjunto: rota ángulos (testimonial, " +
    "beneficio, problema/solución, prueba social, FOMO, urgencia, aspiracional). " +
    "NO repitas el mismo enfoque dos veces. Detalla la foto como si la " +
    "estuvieras describiendo a un fotógrafo profesional, no como un brief vago.";

  const user = `Campaña: "${opts.campaignName}"
Objetivo en Meta: ${opts.objective}
Página/marca: ${opts.fanpageName ?? "(no especificada)"}
Briefing general:
${opts.briefing || "(sin briefing adicional)"}

Segmentación / público objetivo:
${opts.segmentation}

Conjunto de anuncios: "${opts.adsetLabel}"
${opts.audienceBrief ? `Brief específico de este conjunto: ${opts.audienceBrief}` : ""}

Este es el anuncio ${opts.adIndex + 1} de ${opts.totalAdsInSet} en este conjunto.
Formato: ${formatHint}

Llamadas a la acción válidas para este objetivo: ${validCtas}.

Devuelve el JSON con el copy y el imagePrompt en inglés.`;

  return completeJson<AdCopy>({
    workspaceId: opts.workspaceId,
    system,
    user,
    schema: COPY_SCHEMA,
    maxTokens: 1200,
    feature: "meta_ad_copy"
  } as any);
}

// ─────────────────────────────────────────────────────────────────────
// Imagen del anuncio (OpenAI gpt-image-1)
// ─────────────────────────────────────────────────────────────────────

type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";

export async function generateAdImage(opts: {
  workspaceId: string;
  prompt: string;
  size?: ImageSize;
  quality?: "low" | "medium" | "high";
  campaignId: string;
  adId: string;
  /** Copy del anuncio (headline, primaryText, CTA). Si viene, le
   *  pedimos al modelo que GENERE el anuncio terminado con ese texto
   *  ya integrado en el diseño — no solo la foto de fondo. */
  copy?: {
    headline?: string;
    primaryText?: string;
    callToAction?: string;
    brandName?: string;
    valueProps?: string[];
  };
}): Promise<string> {
  if (!isStorageEnabled()) {
    throw new Error("STORAGE_* no configurado — no se pueden guardar imágenes generadas");
  }
  const apiKey = await getOpenAiKeyForWorkspace(opts.workspaceId);
  const size: ImageSize = opts.size ?? "1024x1024";
  // Subimos calidad por defecto a "high" — los anuncios de Meta se
  // ven a tamaño grande y la diferencia de coste con "medium" es
  // pequeña (~$0.10 vs $0.04) comparado con el impacto en CTR de
  // una imagen con composición fina.
  const quality = opts.quality ?? "high";

  // Wrap del prompt con directrices SPECÍFICAS de un anuncio Meta.
  // Sin esto, gpt-image devuelve fotos genéricas tipo stock; con
  // estas directivas pinta composiciones tipo creativo publicitario.
  // Notas de diseño:
  //   - "scroll-stopping" + "thumb-stopping" son términos canónicos
  //     de Meta — el modelo los entiende y los aplica.
  //   - Punto focal único + paleta saturada → la imagen "explota"
  //     en el feed de Instagram/Facebook.
  //   - Negative space para que cuando luego compongamos el copy
  //     encima no quede pisado.
  //   - Negación explícita de texto/letras: gpt-image alucina
  //     palabras en español muy mal — el copy del anuncio se compone
  //     aparte en Meta.
  //   - "Real people, real lighting" → evita el aspecto stock-photo
  //     plano que el modelo da por defecto.
  // Si nos pasan `copy`, generamos un ANUNCIO COMPLETO DISEÑADO con
  // texto, value props y CTA integrados (estilo Freepik). Si no,
  // generamos solo la foto de fondo (modo legacy/fallback).
  //
  // Riesgo conocido: gpt-image puede alucinar letras en español
  // (acentos mal, palabras inventadas). Le pedimos EXPLÍCITAMENTE
  // que respete los textos en castellano EXACTOS, y le damos un layout
  // tipo poster. Si después de probar el texto sale mal, hay que
  // pasar al pipeline de overlay con sharp+SVG.
  const wantsCompleteAd = !!(opts.copy?.headline || opts.copy?.primaryText);
  const placement =
    size === "1024x1024"
      ? "Facebook/Instagram Feed (1:1 square)"
      : size === "1024x1536"
        ? "Instagram Stories / Reels (vertical 4:5)"
        : "Right column / Marketplace (landscape 16:9)";

  const wrappedPrompt = wantsCompleteAd
    ? [
        `Design a COMPLETE Meta Ads creative poster for ${placement}.`,
        `This must look like a finished, designed ad (NOT a plain photo).`,
        `Inspiration: high-end Freepik/Canva ad templates — bold composition,`,
        `branded color blocks, sharp typography, value props with icons, CTA bar at bottom.`,
        ``,
        `=== CAMPAIGN BRIEF ===`,
        opts.prompt,
        ``,
        `=== TEXT TO RENDER ON THE AD (Spanish, render EXACTLY as written) ===`,
        opts.copy?.headline ? `HEADLINE (large, bold, top of frame): "${opts.copy.headline}"` : "",
        opts.copy?.primaryText ? `SUBHEADING / BODY (medium, below headline): "${opts.copy.primaryText}"` : "",
        opts.copy?.valueProps && opts.copy.valueProps.length > 0
          ? `VALUE PROPS (small, with simple line icons, in a row at mid-bottom):\n${opts.copy.valueProps.map((v, i) => `  ${i + 1}. "${v}"`).join("\n")}`
          : "",
        opts.copy?.callToAction
          ? `CTA BUTTON (bottom of frame, contrasting color pill): "${opts.copy.callToAction}"`
          : "",
        opts.copy?.brandName
          ? `BRAND NAME (small footer, optional): "${opts.copy.brandName}"`
          : "",
        ``,
        `=== DESIGN DIRECTIONS ===`,
        `- A hero photographic image fills 40-60% of the frame (real person or product, editorial style, dramatic lighting, vivid colors).`,
        `- The rest is design overlay: a dark color block (deep navy or brand color) with the text rendered in clean sans-serif typography (Inter / Helvetica / Montserrat-like).`,
        `- Headlines have multiple weights and colors for visual hierarchy (e.g. white + brand accent color for emphasis words).`,
        `- Value props arranged in a horizontal row with simple monoline icons (gears, dollar sign, chart, AI chip, lock — pick what fits).`,
        `- CTA button is a horizontal pill in a bold accent color (electric blue, orange, green) with white text.`,
        `- Use consistent saturated brand palette throughout (2-3 colors max).`,
        `- All text MUST be perfectly readable. If you cannot render the exact Spanish text above with correct spelling and accents, leave that area empty rather than producing garbled text.`,
        ``,
        `=== HARD CONSTRAINTS ===`,
        `- Render the Spanish text EXACTLY as written above, including accents (á, é, í, ó, ú, ñ). DO NOT invent or change letters.`,
        `- DO NOT include any other random text, watermarks, logos other than the brand name above, or stock-photo signatures.`,
        `- This is a FINISHED ADVERTISEMENT poster, not a draft, not a photo background — design ready to publish on Meta.`
      ].filter(Boolean).join("\n")
    : [
        // Modo legacy: solo foto, sin texto (fallback si no hay copy).
        `Photographic background for a Meta Ads creative — ${placement}.`,
        ``,
        opts.prompt,
        ``,
        `- Scroll-stopping composition. Single strong focal point.`,
        `- Vivid saturated palette, dramatic editorial lighting.`,
        `- Generous negative space at bottom for overlay text added later.`,
        `- ABSOLUTELY NO text, letters, numbers, logos, watermarks.`,
        `- One photographic scene only — no collages.`
      ].join("\n");

  // Llamada con fallback de modelo: gpt-image-2 si lo soporta la
  // cuenta, gpt-image-1 si OpenAI responde 400 model_not_found.
  async function call(model: string) {
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: wrappedPrompt,
        n: 1,
        size,
        quality,
        output_format: "png"
      })
    });
    return r;
  }

  let resp = await call(IMAGE_MODEL_PRIMARY);
  let modelUsed = IMAGE_MODEL_PRIMARY;
  if (!resp.ok) {
    const txt = await resp.text();
    // Fallback solo si el problema es model not found o invalid model.
    if (/model[_ ]not[_ ]found|invalid_model|does not have access|unknown.*model/i.test(txt)) {
      resp = await call(IMAGE_MODEL_FALLBACK);
      modelUsed = IMAGE_MODEL_FALLBACK;
      if (!resp.ok) {
        const txt2 = await resp.text();
        throw new Error(`OpenAI Image ${resp.status} (fallback): ${txt2.slice(0, 300)}`);
      }
    } else {
      throw new Error(`OpenAI Image ${resp.status}: ${txt.slice(0, 300)}`);
    }
  }
  const data = await resp.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI no devolvió imagen en b64_json");
  const buf = Buffer.from(b64, "base64");

  const s3Key = buildS3Key({
    workspaceId: opts.workspaceId,
    targetType: "meta_campaign",
    targetId: opts.campaignId,
    filename: `ad-${opts.adId}-${Date.now()}.png`
  });
  await uploadBuffer({ s3Key, body: buf, contentType: "image/png" });
  const url = await signedDownloadUrl(s3Key);

  logAiUsage({
    workspaceId: opts.workspaceId,
    feature: "meta_ad_image",
    provider: "openai",
    model: `${modelUsed}-${quality}-${size}`,
    inputTokens: 0,
    outputTokens: 0
  }).catch(() => {});

  return url;
}

// ─────────────────────────────────────────────────────────────────────
// Orquestador: genera todo el contenido de una campaña
// ─────────────────────────────────────────────────────────────────────

/**
 * Genera las 3 variantes de aspecto (square / portrait / landscape)
 * para un mismo prompt EN PARALELO. Devuelve un objeto con las 3
 * URLs en R2. Wall-clock similar a generar una sola (las 3 llamadas
 * van a OpenAI a la vez), coste ≈ 3x.
 *
 * Mapeo a placements de Meta:
 *   square    (1024x1024)  → Feed móvil + Feed desktop + Instagram Feed
 *   portrait  (1024x1536)  → Stories, Reels, Feed 4:5 (recomendado)
 *   landscape (1536x1024)  → Right column desktop, Marketplace,
 *                            Audience Network
 */
export type AdImageVariants = {
  square: string;
  portrait: string;
  landscape: string;
};

export async function generateAdImageAllVariants(opts: {
  workspaceId: string;
  prompt: string;
  campaignId: string;
  adId: string;
  quality?: "low" | "medium" | "high";
  /** Si viene, generamos el anuncio COMPLETO diseñado (con texto,
   *  value props, CTA). Si no, solo la foto de fondo (modo legacy). */
  copy?: {
    headline?: string;
    primaryText?: string;
    callToAction?: string;
    brandName?: string;
    valueProps?: string[];
  };
}): Promise<AdImageVariants> {
  const [square, portrait, landscape] = await Promise.all([
    generateAdImage({
      ...opts,
      adId: `${opts.adId}-sq`,
      size: "1024x1024"
    }),
    generateAdImage({
      ...opts,
      adId: `${opts.adId}-pt`,
      size: "1024x1536"
    }),
    generateAdImage({
      ...opts,
      adId: `${opts.adId}-ls`,
      size: "1536x1024"
    })
  ]);
  return { square, portrait, landscape };
}

export type GenerateContentReport = {
  segmentationExpanded: boolean;
  adsAttempted: number;
  adsReady: number;
  adsFailed: number;
  errors: { adId: string; reason: string }[];
};

export async function generateAllContent(opts: {
  workspaceId: string;
  campaignId: string;
}): Promise<GenerateContentReport> {
  const campaignOrNull = await prisma.metaCampaign.findFirst({
    where: { id: opts.campaignId, workspaceId: opts.workspaceId, deletedAt: null },
    include: { adsets: { include: { ads: true } } }
  });
  if (!campaignOrNull) throw new Error("Campaña no encontrada");
  // Const intermedia para que TS no pierda el narrowing dentro de los
  // closures async del worker.
  const campaign = campaignOrNull;

  const report: GenerateContentReport = {
    segmentationExpanded: false,
    adsAttempted: 0,
    adsReady: 0,
    adsFailed: 0,
    errors: []
  };

  // 1) Segmentación expandida
  try {
    const seg = await expandSegmentation({
      workspaceId: opts.workspaceId,
      briefing: campaign.description ?? "",
      segmentationRaw: campaign.segmentationRaw,
      locationsIncluded: campaign.locationsIncluded,
      locationsExcluded: campaign.locationsExcluded
    });
    await prisma.metaCampaign.update({
      where: { id: campaign.id },
      data: { expandedSegmentation: seg as any }
    });
    report.segmentationExpanded = true;
  } catch (e: any) {
    report.errors.push({ adId: "(segmentation)", reason: e?.message ?? String(e) });
  }

  // 2) Por cada adset, por cada ad: copy + imagen (en paralelo con throttle)
  const allTasks: { adset: typeof campaign.adsets[number]; ad: typeof campaign.adsets[number]["ads"][number]; idx: number; total: number }[] = [];
  for (const adset of campaign.adsets) {
    adset.ads.forEach((ad, idx) => {
      allTasks.push({ adset, ad, idx, total: adset.ads.length });
    });
  }

  // Pequeño semáforo manual para limitar concurrencia.
  let cursor = 0;
  async function worker() {
    while (cursor < allTasks.length) {
      const i = cursor++;
      const t = allTasks[i];
      report.adsAttempted++;
      try {
        await prisma.metaAd.update({
          where: { id: t.ad.id },
          data: { contentStatus: "GENERATING", lastError: null }
        });
        const copy = await generateCopyForAd({
          workspaceId: opts.workspaceId,
          campaignName: campaign.name,
          briefing: campaign.description ?? "",
          objective: campaign.objective,
          fanpageName: campaign.fanpageName,
          segmentation: campaign.segmentationRaw,
          audienceBrief: t.adset.audienceBrief,
          adsetLabel: t.adset.label,
          format: t.ad.format as "IMAGE" | "CAROUSEL" | "VIDEO",
          adIndex: t.idx,
          totalAdsInSet: t.total
        });

        // Pasamos el copy estructurado al generador de imagen para
        // que produzca el anuncio COMPLETO (texto + value props +
        // CTA bar), no solo la foto de fondo. Extraemos hasta 4
        // value props del primaryText si es bullet-list, si no
        // dejamos vacío y el modelo no los pinta.
        const adCopy = {
          headline: copy.headline,
          primaryText: copy.primaryText,
          callToAction: ctaLabelForUI(copy.callToAction),
          brandName: campaign.fanpageName ?? undefined,
          valueProps: extractValueProps(copy.primaryText)
        };

        let mediaUrls: string[] = [];
        let mediaVariants: any = null;
        if (t.ad.format === "IMAGE") {
          const variants = await generateAdImageAllVariants({
            workspaceId: opts.workspaceId,
            prompt: copy.imagePrompt,
            campaignId: campaign.id,
            adId: t.ad.id,
            copy: adCopy
          });
          mediaVariants = variants;
          mediaUrls = [variants.square]; // fallback / legacy compat
        } else if (t.ad.format === "CAROUSEL") {
          // Generamos N tarjetas. Cada una usa el imagePrompt principal
          // + la variación de ángulo en altImageVariations si existe.
          // Para cada tarjeta producimos las 3 variantes en paralelo —
          // así el carrusel se ve igual de bien en Feed, Stories y
          // Marketplace.
          const variations = [copy.imagePrompt, ...(copy.altImageVariations ?? []).slice(0, CAROUSEL_CARDS - 1)];
          while (variations.length < CAROUSEL_CARDS) variations.push(copy.imagePrompt);
          const cards = await Promise.all(
            variations.slice(0, CAROUSEL_CARDS).map((p, k) =>
              generateAdImageAllVariants({
                workspaceId: opts.workspaceId,
                prompt: p,
                campaignId: campaign.id,
                adId: `${t.ad.id}-card${k}`,
                copy: adCopy
              })
            )
          );
          mediaVariants = cards; // array de {square, portrait, landscape}
          mediaUrls = cards.map((c) => c.square);
        }
        // VIDEO: solo copy, mediaUrls vacío (vídeo se sube manual)

        await prisma.metaAd.update({
          where: { id: t.ad.id },
          data: {
            headline: copy.headline,
            primaryText: copy.primaryText,
            description: copy.description,
            callToAction: copy.callToAction,
            mediaUrls,
            mediaVariants: mediaVariants as any,
            contentStatus: "READY_FOR_REVIEW",
            lastError: null
          }
        });
        report.adsReady++;
      } catch (e: any) {
        const reason = e?.message ?? String(e);
        await prisma.metaAd
          .update({
            where: { id: t.ad.id },
            data: { contentStatus: "FAILED", lastError: reason.slice(0, 800) }
          })
          .catch(() => {});
        report.adsFailed++;
        report.errors.push({ adId: t.ad.id, reason });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_IMAGE_GENS, allTasks.length) }, () => worker())
  );

  // 3) Estado de la campaña según resultado
  const nextStatus =
    report.adsReady > 0 && report.adsFailed === 0
      ? "PENDING_REVIEW"
      : report.adsReady === 0
        ? "FAILED"
        : "PENDING_REVIEW"; // ready parcial: el user revisa los OK y reintenta los FAILED

  await prisma.metaCampaign.update({
    where: { id: campaign.id },
    data: { status: nextStatus as any }
  });

  return report;
}

/**
 * Mapea los CTA codes de Meta (LEARN_MORE, SIGN_UP, …) a etiquetas
 * en castellano legibles que se renderizan en el botón del anuncio.
 */
function ctaLabelForUI(code?: string): string | undefined {
  if (!code) return undefined;
  const map: Record<string, string> = {
    LEARN_MORE: "Saber más",
    SIGN_UP: "Regístrate",
    GET_QUOTE: "Pide presupuesto",
    CONTACT_US: "Contáctanos",
    APPLY_NOW: "Solicítalo",
    SHOP_NOW: "Comprar ahora",
    GET_OFFER: "Llévatelo",
    ORDER_NOW: "Pídelo ya",
    BOOK_TRAVEL: "Reservar",
    SEE_MORE: "Ver más",
    INSTALL_NOW: "Instalar",
    USE_APP: "Abrir app",
    LIKE_PAGE: "Me gusta",
    WATCH_MORE: "Ver vídeo"
  };
  return map[code] ?? code.replace(/_/g, " ").toLowerCase();
}

/**
 * Si el primaryText viene en formato lista (líneas con "-", "•",
 * "✓" o numeradas), extrae hasta 4 ítems para pintarlos como value
 * props en el anuncio. Si el copy es un párrafo, devuelve [] y el
 * modelo no pinta esa sección.
 */
function extractValueProps(text?: string | null): string[] {
  if (!text) return [];
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const bullets = lines
    .map((l) => l.replace(/^([\-•✓✅*]|\d+[.)])\s*/, "").trim())
    .filter((l, i, arr) => l && l !== arr[i - 1])
    .filter((_, _i, arr) => arr.length >= 2 && arr.length <= 6);
  // Solo lo consideramos lista si > 1 línea quedó tras el strip.
  if (bullets.length < 2) return [];
  return bullets.slice(0, 4);
}

/**
 * Regenera UN anuncio concreto. Usa el customPrompt como prompt
 * principal si viene; si no, reusa el imagePrompt original del copy
 * existente. Si regenerateCopy=true, además pide a Claude un nuevo
 * copy completo (lo que también refresca el imagePrompt).
 *
 * Persiste mediaVariants + mediaUrls al terminar. Marca contentStatus
 * = READY_FOR_REVIEW en éxito o FAILED + lastError en fallo.
 */
export async function regenerateOneAd(opts: {
  workspaceId: string;
  campaignId: string;
  adId: string;
  customPrompt: string | null;
  regenerateCopy: boolean;
}): Promise<void> {
  const campaign = await prisma.metaCampaign.findFirst({
    where: { id: opts.campaignId, workspaceId: opts.workspaceId, deletedAt: null },
    include: { adsets: true }
  });
  if (!campaign) throw new Error("Campaña no encontrada");
  const ad = await prisma.metaAd.findFirst({
    where: { id: opts.adId, adset: { campaignId: campaign.id } },
    include: { adset: true }
  });
  if (!ad) throw new Error("Anuncio no encontrado");

  // 1) Copy: si regenerateCopy, pedimos uno nuevo a Claude. Si no,
  //    reusamos el que ya tiene el ad (headline + primaryText + cta).
  let copy: any;
  if (opts.regenerateCopy || !ad.headline) {
    copy = await generateCopyForAd({
      workspaceId: opts.workspaceId,
      campaignName: campaign.name,
      briefing: campaign.description ?? "",
      objective: campaign.objective,
      fanpageName: campaign.fanpageName,
      segmentation: campaign.segmentationRaw,
      audienceBrief: ad.adset.audienceBrief,
      adsetLabel: ad.adset.label,
      format: ad.format as "IMAGE" | "CAROUSEL" | "VIDEO",
      adIndex: 0,
      totalAdsInSet: 1
    });
    await prisma.metaAd.update({
      where: { id: ad.id },
      data: {
        headline: copy.headline,
        primaryText: copy.primaryText,
        description: copy.description,
        callToAction: copy.callToAction
      }
    });
  } else {
    copy = {
      headline: ad.headline,
      primaryText: ad.primaryText,
      description: ad.description,
      callToAction: ad.callToAction,
      imagePrompt: opts.customPrompt || ad.primaryText || ad.headline || ""
    };
  }

  const adCopy = {
    headline: copy.headline,
    primaryText: copy.primaryText,
    callToAction: ctaLabelForUI(copy.callToAction),
    brandName: campaign.fanpageName ?? undefined,
    valueProps: extractValueProps(copy.primaryText)
  };

  // Si el user metió customPrompt, ese es el prompt principal. Si no,
  // usamos el imagePrompt generado por Claude.
  const prompt = opts.customPrompt?.trim() || copy.imagePrompt;

  // Genera las 3 variantes. Para regen rápido podríamos generar solo
  // la square, pero seguimos haciendo las 3 para mantener la
  // consistencia con la primera generación.
  const variants = await generateAdImageAllVariants({
    workspaceId: opts.workspaceId,
    prompt,
    campaignId: campaign.id,
    adId: ad.id + "-regen-" + Date.now(),
    copy: adCopy
  });

  await prisma.metaAd.update({
    where: { id: ad.id },
    data: {
      mediaUrls: [variants.square],
      mediaVariants: variants as any,
      contentStatus: "READY_FOR_REVIEW",
      lastError: null
    }
  });
}
