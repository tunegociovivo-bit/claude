/**
 * Cliente Anthropic de los módulos de contenidos (portado del Hub).
 * La clave la pone Negocio Vivo en el entorno (ANTHROPIC_API_KEY); el cliente
 * del CRM nunca la ve ni la configura.
 */
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { fetchAssetBuffer } from "@/lib/storage/fetch-asset";
import { stripLoneSurrogates, deepSanitizeStrings } from "./sanitize";

// Modelos (configurables por entorno). Por defecto, los mismos del Hub.
export const DEFAULT_MODEL = process.env.CONTENT_AI_MODEL || "claude-opus-4-7";
export const FAST_MODEL = process.env.CONTENT_AI_FAST_MODEL || "claude-sonnet-4-6";

export class AIDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIDisabledError";
  }
}

let cached: { key: string; client: Anthropic } | null = null;

export async function getAnthropicForWorkspace(_workspaceId: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AIDisabledError("La IA no está configurada en este CRM (falta ANTHROPIC_API_KEY). Avisa a Negocio Vivo.");
  }
  if (!cached || cached.key !== apiKey) cached = { key: apiKey, client: new Anthropic({ apiKey }) };
  return cached.client;
}

function logUsage(opts: { workspaceId: string; userId?: string | null; projectId?: string | null; feature: string; model: string; resp: any }) {
  import("./usage")
    .then(({ logAiUsage }) =>
      logAiUsage({
        workspaceId: opts.workspaceId,
        userId: opts.userId ?? null,
        projectId: opts.projectId ?? null,
        feature: opts.feature,
        provider: "anthropic",
        model: opts.model,
        inputTokens: opts.resp?.usage?.input_tokens ?? 0,
        outputTokens: opts.resp?.usage?.output_tokens ?? 0,
      })
    )
    .catch(() => {});
}

export async function complete(opts: {
  workspaceId: string;
  system: string;
  user: string;
  maxTokens?: number;
  model?: string;
  thinking?: boolean;
  userId?: string | null;
  projectId?: string | null;
  feature?: string;
}): Promise<string> {
  const client = await getAnthropicForWorkspace(opts.workspaceId);
  const model = opts.model ?? DEFAULT_MODEL;
  const resp = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    ...(opts.thinking ? { thinking: { type: "adaptive" as const } } : {}),
    system: [{ type: "text", text: stripLoneSurrogates(opts.system), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: stripLoneSurrogates(opts.user) }],
  } as any);
  logUsage({ ...opts, feature: opts.feature ?? "complete", model, resp });
  return (resp as any).content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
}

export async function completeVision(opts: {
  workspaceId: string;
  system: string;
  userText: string;
  imageUrls: string[];
  maxTokens?: number;
  model?: string;
  userId?: string | null;
  feature?: string;
}): Promise<string> {
  const client = await getAnthropicForWorkspace(opts.workspaceId);
  const model = opts.model ?? DEFAULT_MODEL;
  const imageBlocks = await Promise.all(opts.imageUrls.slice(0, 20).map((url) => fetchImageAsBase64Block(url)));
  const validImages = imageBlocks.filter((b): b is NonNullable<typeof b> => b !== null);
  const content: any[] = [...validImages, { type: "text", text: opts.userText }];
  const resp = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    system: [{ type: "text", text: stripLoneSurrogates(opts.system), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: deepSanitizeStrings(content) }],
  } as any);
  logUsage({ workspaceId: opts.workspaceId, userId: opts.userId, feature: opts.feature ?? "vision", model, resp });
  return (resp as any).content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
}

/**
 * Adapta un JSON schema a las reglas del modo estricto de structured output:
 * additionalProperties:false en todos los objetos y sin keywords no soportadas.
 */
const STRIP_KEYWORDS: Record<string, string[]> = {
  integer: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"],
  number: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"],
  string: ["pattern", "minLength", "maxLength", "format"],
  array: ["minItems", "maxItems", "uniqueItems"],
};

function strictifySchema<T = any>(schema: T): T {
  if (Array.isArray(schema)) return schema.map(strictifySchema) as any;
  if (schema && typeof schema === "object") {
    const s: any = { ...schema };
    if (typeof s.type === "string" && STRIP_KEYWORDS[s.type]) {
      for (const k of STRIP_KEYWORDS[s.type]) if (k in s) delete s[k];
    }
    if ("additionalProperties" in s && s.additionalProperties !== false) s.additionalProperties = false;
    if (s.type === "object") {
      if (s.additionalProperties === undefined) s.additionalProperties = false;
      if (s.properties && typeof s.properties === "object") {
        const next: any = {};
        for (const [k, v] of Object.entries(s.properties)) next[k] = strictifySchema(v);
        s.properties = next;
      }
    }
    if (s.items) s.items = strictifySchema(s.items);
    if (s.anyOf) s.anyOf = (s.anyOf as any[]).map(strictifySchema);
    if (s.oneOf) s.oneOf = (s.oneOf as any[]).map(strictifySchema);
    if (s.allOf) s.allOf = (s.allOf as any[]).map(strictifySchema);
    return s;
  }
  return schema;
}

export async function completeJson<T = any>(opts: {
  workspaceId: string;
  userId?: string | null;
  projectId?: string | null;
  feature?: string;
  system: string;
  user: string;
  schema: any;
  maxTokens?: number;
  model?: string;
  imageUrls?: string[];
  requireAllImages?: boolean;
  inlineImages?: Array<{ mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string }>;
}): Promise<T> {
  const client = await getAnthropicForWorkspace(opts.workspaceId);
  const strictSchema = strictifySchema(opts.schema);
  let userContent: any;
  if (opts.inlineImages && opts.inlineImages.length > 0) {
    const blocks = await Promise.all(
      opts.inlineImages.slice(0, 20).map(async (image) => {
        const normalized = await normalizeImageForClaude(Buffer.from(image.data, "base64"));
        return normalized ? toBlock(normalized) : null;
      })
    );
    userContent = [...blocks.filter(Boolean), { type: "text", text: opts.user }];
  } else if (opts.imageUrls && opts.imageUrls.length > 0) {
    const blocks = await Promise.all(opts.imageUrls.slice(0, 20).map((url) => fetchImageAsBase64Block(url)));
    const valid = blocks.filter((b): b is NonNullable<typeof b> => b !== null);
    if (opts.requireAllImages && valid.length !== opts.imageUrls.length) {
      throw new Error("No se pudieron leer todas las imágenes de referencia. Vuelve a subirlas antes de generar.");
    }
    userContent = [...valid, { type: "text", text: opts.user }];
  } else {
    userContent = opts.user;
  }
  const model = opts.model ?? DEFAULT_MODEL;
  const resp: any = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 2048,
    system: [{ type: "text", text: stripLoneSurrogates(opts.system), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: deepSanitizeStrings(userContent) }],
    output_config: { format: { type: "json_schema", schema: strictSchema } },
  } as any);
  logUsage({ ...opts, feature: opts.feature ?? "complete_json", model, resp });
  const text = resp.content.find((b: any) => b.type === "text");
  if (!text) throw new Error("Sin respuesta de texto del modelo");
  if (resp.stop_reason === "max_tokens") {
    throw new Error(
      `Respuesta truncada por max_tokens (${opts.maxTokens ?? 2048}). Reduce el tamaño del prompt o aumenta maxTokens.`
    );
  }
  try {
    return JSON.parse(text.text) as T;
  } catch (e: any) {
    const m = /\{[\s\S]*\}/.exec(text.text);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {}
    }
    throw new Error(`JSON inválido del modelo (${e?.message ?? e}). Stop reason: ${resp.stop_reason}.`);
  }
}

type ImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } };

function toBlock(buf: Buffer): ImageBlock {
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") } };
}

/**
 * Regla de Negocio Vivo: SIEMPRE redimensionar antes de mandar imágenes a la
 * API de Anthropic (máx. 1800 px de lado, JPEG calidad 82) para evitar el error
 * «image dimensions exceed max allowed size for many-image requests».
 */
export async function normalizeImageForClaude(input: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(input, { failOn: "none" })
      .rotate()
      .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch (e: any) {
    console.warn(`[vision] imagen no procesable: ${e?.message ?? e}`);
    return null;
  }
}

/**
 * Descarga una imagen server-side y la manda inline en base64 (Anthropic no
 * descarga URLs de buckets sin robots.txt permisivo). Los archivos propios del
 * CRM (/api/files/...) se leen directamente de la base de datos.
 */
async function fetchImageAsBase64Block(url: string): Promise<ImageBlock | null> {
  try {
    // Archivos propios desde BD; externos con anti-SSRF y tope de tamaño.
    const { buffer } = await fetchAssetBuffer(url, { timeoutMs: 15_000, maxBytes: 25 * 1024 * 1024 });
    const normalized = await normalizeImageForClaude(buffer);
    return normalized ? toBlock(normalized) : null;
  } catch (e: any) {
    console.warn(`[vision] fetch fail ${url.slice(0, 80)}: ${e?.message ?? e}`);
    return null;
  }
}
