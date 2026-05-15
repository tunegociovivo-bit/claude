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
 * Helper "vision": acepta una lista de URLs de imágenes (Claude las
 * descarga internamente) además del texto del usuario. Útil para
 * analizar refs visuales, screenshots de webs, etc.
 *
 * Las imágenes se mandan como bloques `{type: "image", source: {type:
 * "url", url}}`. Si una URL no es accesible Claude responde igual con un
 * warning interno.
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
  const content: any[] = [
    ...opts.imageUrls.slice(0, 20).map((url) => ({
      type: "image",
      source: { type: "url", url }
    })),
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
 * Recorre un schema JSON y se asegura de que TODO objeto tenga
 * `additionalProperties: false` (requerido por la API de structured
 * output de Anthropic en modo strict). Idempotente.
 */
function strictifySchema<T = any>(schema: T): T {
  if (Array.isArray(schema)) {
    return schema.map(strictifySchema) as any;
  }
  if (schema && typeof schema === "object") {
    const s: any = { ...schema };
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
}): Promise<T> {
  const client = await getAnthropicForWorkspace(opts.workspaceId);
  const strictSchema = strictifySchema(opts.schema);
  const resp = await client.messages.create({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? 2048,
    system: [
      { type: "text", text: opts.system, cache_control: { type: "ephemeral" } }
    ],
    messages: [{ role: "user", content: opts.user }],
    output_config: {
      format: { type: "json_schema", schema: strictSchema }
    }
  } as any);
  const text = resp.content.find((b) => b.type === "text") as any;
  if (!text) throw new Error("Sin respuesta de texto del modelo");
  return JSON.parse(text.text) as T;
}
