/**
 * Cliente Anthropic por negocio, sin dependencias pesadas (lo usan Sonia y la
 * bandeja de WhatsApp además de los módulos de contenidos). La clave es la del
 * negocio si el operador le ha puesto una en /admin; si no, la de Negocio Vivo
 * del entorno (ANTHROPIC_API_KEY).
 */
import Anthropic from "@anthropic-ai/sdk";
import { getApiKey } from "@/lib/api-keys";

export class AIDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIDisabledError";
  }
}

// Un cliente SDK por clave y opciones (las claves de cada negocio pueden ser distintas).
const clients = new Map<string, Anthropic>();

export function anthropicClientForKey(apiKey: string, opts: { timeout?: number; maxRetries?: number } = {}): Anthropic {
  const id = `${apiKey}|${opts.timeout ?? ""}|${opts.maxRetries ?? ""}`;
  let client = clients.get(id);
  if (!client) {
    if (clients.size > 200) clients.clear();
    client = new Anthropic({ apiKey, ...opts });
    clients.set(id, client);
  }
  return client;
}

/** Clave de Anthropic del negocio (propia o de Negocio Vivo). */
export async function anthropicKeyForWorkspace(workspaceId: string): Promise<string> {
  const { key } = await getApiKey(workspaceId, "anthropic");
  if (!key) throw new AIDisabledError("La IA no está configurada en este CRM (falta la clave de Anthropic). Avisa a Negocio Vivo.");
  return key;
}

export async function getAnthropicForWorkspace(workspaceId: string, opts: { timeout?: number; maxRetries?: number } = {}): Promise<Anthropic> {
  return anthropicClientForKey(await anthropicKeyForWorkspace(workspaceId), opts);
}
