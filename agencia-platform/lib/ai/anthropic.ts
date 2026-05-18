import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "./crypto";

export const DEFAULT_MODEL = "claude-opus-4-7";

/**
 * Devuelve un cliente Anthropic configurado para el workspace.
 * Prioridad: settings del workspace → env var ANTHROPIC_API_KEY.
 * Throw si no hay ninguna.
 */
export async function getAnthropicForWorkspace(workspaceId: string) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const settings = (ws?.settings as any) ?? {};
  const encrypted: string | undefined = settings?.ai?.anthropicApiKey;

  let apiKey: string | null = null;
  if (encrypted) apiKey = decryptSecret(encrypted);
  if (!apiKey) apiKey = process.env.ANTHROPIC_API_KEY ?? null;

  if (!apiKey) {
    throw new AIDisabledError(
      "No hay API key de Anthropic. Configúrala en /admin/ai o en la variable ANTHROPIC_API_KEY."
    );
  }
  return new Anthropic({ apiKey });
}

export class AIDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIDisabledError";
  }
}

/**
 * Helper de "completar texto" con system prompt cacheable.
 */
export async function complete(opts: {
  workspaceId: string;
  system: string;
  user: string;
  maxTokens?: number;
  model?: string;
  thinking?: boolean;
  /** Para tracking de coste */
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
    system: [
      {
        type: "text",
        text: opts.system,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [{ role: "user", content: opts.user }]
  });
  // Log de uso (no bloqueante)
  const { logAiUsage } = await import("./usage");
  logAiUsage({
    workspaceId: opts.workspaceId,
    userId: opts.userId ?? null,
    projectId: opts.projectId ?? null,
    feature: opts.feature ?? "complete",
    provider: "anthropic",
    model,
    inputTokens: (resp as any).usage?.input_tokens ?? 0,
    outputTokens: (resp as any).usage?.output_tokens ?? 0
  }).catch(() => {});
  return resp.content
    .filter((b) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
}

/**
 * Helper "vision": acepta una lista de URLs de imágenes y las manda
 * a Claude junto con un texto. Útil para analizar refs visuales,
 * screenshots, etc.
 *
 * Implementación: en vez de pasarle a Claude `{source: type:"url"}` —
 * que hace que Claude fetchee la URL desde sus servidores Y respete
 * el robots.txt del dominio (fallo común con buckets R2/S3 sin
 * robots.txt explícitamente permisivo) — descargamos las imágenes
 * SERVER-SIDE aquí y las pasamos como `{source: type:"base64"}`.
 * Anthropic no toca robots.txt para datos inline.
 *
 * Si una URL falla al descargar, se omite en el batch y se loguea
 * — el resto siguen.
 */
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
  const imageBlocks = await Promise.all(
    opts.imageUrls.slice(0, 20).map((url) => fetchImageAsBase64Block(url))
  );
  const validImages = imageBlocks.filter((b): b is NonNullable<typeof b> => b !== null);
  const content: any[] = [
    ...validImages,
    { type: "text", text: opts.userText }
  ];
  const resp = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }]
  });
  const { logAiUsage } = await import("./usage");
  logAiUsage({
    workspaceId: opts.workspaceId,
    userId: opts.userId ?? null,
    projectId: null,
    feature: opts.feature ?? "vision",
    provider: "anthropic",
    model,
    inputTokens: (resp as any).usage?.input_tokens ?? 0,
    outputTokens: (resp as any).usage?.output_tokens ?? 0
  }).catch(() => {});
  return resp.content
    .filter((b) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
}

/**
 * Recorre un schema JSON y lo adapta a las reglas del modo strict de
 * Anthropic structured output:
 *   - todo `type: "object"` debe tener `additionalProperties: false`
 *   - `type: "integer"` y `"number"` NO soportan minimum, maximum,
 *     exclusiveMinimum, exclusiveMaximum, multipleOf
 *   - `type: "string"` no soporta pattern, minLength, maxLength, format
 *   - `type: "array"` no soporta minItems, maxItems, uniqueItems
 *
 * Idempotente. Aplica recursivamente a properties, items, anyOf, oneOf, allOf.
 */
const STRIP_KEYWORDS: Record<string, string[]> = {
  integer: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"],
  number: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"],
  string: ["pattern", "minLength", "maxLength", "format"],
  array: ["minItems", "maxItems", "uniqueItems"]
};

function strictifySchema<T = any>(schema: T): T {
  if (Array.isArray(schema)) {
    return schema.map(strictifySchema) as any;
  }
  if (schema && typeof schema === "object") {
    const s: any = { ...schema };
    // Quitar keywords no soportadas según el tipo
    if (typeof s.type === "string" && STRIP_KEYWORDS[s.type]) {
      for (const k of STRIP_KEYWORDS[s.type]) {
        if (k in s) delete s[k];
      }
    }
    // BLINDAJE: cualquier subschema que tenga additionalProperties
    // (incluso sin type=object explícito, o con type=object pero como
    // objeto/true) se fuerza a false. Strict mode lo exige siempre así.
    if ("additionalProperties" in s && s.additionalProperties !== false) {
      s.additionalProperties = false;
    }
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

/**
 * Helper de salida estructurada JSON usando un schema.
 */
export async function completeJson<T = any>(opts: {
  workspaceId: string;
  system: string;
  user: string;
  schema: any;
  maxTokens?: number;
  model?: string;
  /** Si se pasan, se incluyen como bloques type=image en el mensaje
   *  user. Útil para que Claude VEA fotos del cliente y las describa
   *  físicamente en el JSON estructurado (image_prompt). */
  imageUrls?: string[];
}): Promise<T> {
  const client = await getAnthropicForWorkspace(opts.workspaceId);
  const strictSchema = strictifySchema(opts.schema);
  if (process.env.NODE_ENV !== "production" || process.env.DEBUG_AI_SCHEMA === "1") {
    console.log("[completeJson] schema enviado:", JSON.stringify(strictSchema));
  }
  // Construir content del user: si hay imágenes, las metemos como
  // bloques al inicio + texto al final.
  let userContent: any;
  if (opts.imageUrls && opts.imageUrls.length > 0) {
    // Igual que en completeVision: descargamos server-side y mandamos
    // base64 para evitar el bloqueo por robots.txt.
    const blocks = await Promise.all(
      opts.imageUrls.slice(0, 20).map((url) => fetchImageAsBase64Block(url))
    );
    const valid = blocks.filter((b): b is NonNullable<typeof b> => b !== null);
    userContent = [...valid, { type: "text", text: opts.user }];
  } else {
    userContent = opts.user;
  }
  const resp = await client.messages.create({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? 2048,
    system: [
      { type: "text", text: opts.system, cache_control: { type: "ephemeral" } }
    ],
    messages: [{ role: "user", content: userContent }],
    output_config: {
      format: { type: "json_schema", schema: strictSchema }
    }
  } as any);
  const text = resp.content.find((b) => b.type === "text") as any;
  if (!text) throw new Error("Sin respuesta de texto del modelo");
  if (resp.stop_reason === "max_tokens") {
    // El JSON está cortado a mitad — JSON.parse fallará con "Unterminated
    // string". Avisamos al caller con un mensaje accionable en lugar de
    // dejar que el parser explote ciegamente.
    throw new Error(
      `Respuesta truncada por max_tokens (${opts.maxTokens ?? 2048}). ` +
        `Reduce el tamaño del prompt o aumenta maxTokens. ` +
        `Texto recibido hasta cortarse: ${text.text.length} chars.`
    );
  }
  try {
    return JSON.parse(text.text) as T;
  } catch (e: any) {
    // Último intento: ¿hay un objeto JSON válido dentro del texto?
    // (a veces el modelo añade prosa antes pese al schema).
    const m = /\{[\s\S]*\}/.exec(text.text);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {}
    }
    throw new Error(
      `JSON inválido del modelo (${e?.message ?? e}). Stop reason: ${resp.stop_reason}. ` +
        `Primeros 200 chars: ${text.text.slice(0, 200)}`
    );
  }
}

/**
 * Descarga una URL de imagen server-side y la convierte al bloque
 * vision de Anthropic en formato base64. Devuelve null si la
 * descarga falla (URL caída, content-type no soportado, demasiado
 * grande) — el caller filtra los nulls y sigue con las que sí.
 *
 * Por qué base64 en vez de URL:
 *   - Anthropic con source:type=url hace fetch desde sus servidores
 *     y RESPETA el robots.txt del dominio. Buckets R2/S3 públicos
 *     sin robots.txt explícitamente permisivo devuelven el error
 *     "This URL is disallowed by the website's robots.txt file"
 *     y la generación falla.
 *   - source:type=base64 lleva los bytes inline en el mensaje —
 *     no hay fetch externo, no aplica robots.txt.
 *
 * Mime types soportados por la API: image/jpeg, image/png,
 * image/gif, image/webp. Otros se rechazan.
 *
 * Límite suave: 5MB por imagen (la API admite hasta 20MB pero
 * cada request acumula y el modelo se rinde con contexto enorme).
 */
async function fetchImageAsBase64Block(url: string): Promise<
  { type: "image"; source: { type: "base64"; media_type: string; data: string } } | null
> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    const resp = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    clearTimeout(timer);
    if (!resp.ok) {
      console.warn(`[vision] HTTP ${resp.status} al descargar ${url.slice(0, 80)}`);
      return null;
    }
    let mediaType = (resp.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    // Algunos buckets devuelven octet-stream para imágenes — inferimos
    // por extensión cuando es ambiguo.
    if (!mediaType.startsWith("image/")) {
      const ext = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
      const guess: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp"
      };
      mediaType = guess[ext] ?? "";
    }
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType)) {
      console.warn(`[vision] mime no soportado (${mediaType}) en ${url.slice(0, 80)}`);
      return null;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > 5 * 1024 * 1024) {
      console.warn(`[vision] imagen > 5MB (${(buf.length / 1024 / 1024).toFixed(1)}MB), saltando ${url.slice(0, 80)}`);
      return null;
    }
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: buf.toString("base64")
      }
    };
  } catch (e: any) {
    console.warn(`[vision] fetch fail ${url.slice(0, 80)}: ${e?.message ?? e}`);
    return null;
  }
}
