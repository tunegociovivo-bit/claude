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

const IMAGE_MODEL = "gpt-image-1"; // OpenAI /v1/images/generations
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
    "Eres un copywriter senior de campañas Meta. Escribes copys en castellano " +
    "que CONVIERTEN: titular gancho, texto principal que aporta valor o crea " +
    "urgencia, descripción corta, y una llamada a la acción del catálogo Meta. " +
    "Además, generas un imagePrompt EN INGLÉS muy descriptivo para un generador " +
    "de imagen (gpt-image), describiendo composición fotográfica, estilo " +
    "(realismo editorial), elementos visuales, paleta de color y espacio negativo " +
    "abajo para overlay de texto. NO incluyas texto legible en la imagen — el " +
    "texto se compone aparte. Variedad: si el user pide varios anuncios para el " +
    "mismo conjunto, NO repitas el mismo enfoque, varía ángulo (testimonial, " +
    "beneficio, problema/solución, prueba social, etc.).";

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
}): Promise<string> {
  if (!isStorageEnabled()) {
    throw new Error("STORAGE_* no configurado — no se pueden guardar imágenes generadas");
  }
  const apiKey = await getOpenAiKeyForWorkspace(opts.workspaceId);
  const size: ImageSize = opts.size ?? "1024x1024";
  const quality = opts.quality ?? "medium";

  // Añadimos hardcoded la negación de texto en imagen — gpt-image
  // tiende a alucinar letras en español.
  const safePrompt =
    opts.prompt +
    "\n\nCRITICAL: NO readable text, NO letters, NO numbers, NO logos, NO watermarks. " +
    "Editorial photographic realism. Composition with ample negative space at the bottom.";

  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt: safePrompt,
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
    model: `${IMAGE_MODEL}-${quality}`,
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

        let mediaUrls: string[] = [];
        let mediaVariants: any = null;
        if (t.ad.format === "IMAGE") {
          // Generamos las 3 variantes de aspecto en paralelo. Meta
          // necesita square (Feed), portrait (Stories/Reels) y
          // landscape (Marketplace/Right column) para que el anuncio
          // se vea bien en todos los placements.
          const variants = await generateAdImageAllVariants({
            workspaceId: opts.workspaceId,
            prompt: copy.imagePrompt,
            campaignId: campaign.id,
            adId: t.ad.id
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
                adId: `${t.ad.id}-card${k}`
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
