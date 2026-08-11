/**
 * Registro de proveedores de modelo (Slice 2c) — SOLO interfaces + slots de
 * routing. NO llama a ningún proveedor externo ni requiere API keys. Slice 3
 * implementará los adaptadores reales tras estos slots.
 *
 * Puro y determinista: la disponibilidad se decide por presencia de key en el
 * `env` que se pasa (sin efectos de red). Sin key → `unavailable` (no rompe el
 * flujo: el orquestador enruta a lo disponible o escala).
 */
export type Capability = "tool_use" | "long_context" | "cheap" | "vision" | "web_search" | "reasoning";
export type ProviderId = "anthropic" | "openai" | "gemini" | "perplexity";

export type ModelSlot = {
  id: string; // "anthropic:opus", ...
  provider: ProviderId;
  model: string;
  capabilities: Capability[];
  region?: string;
  /** Coste aproximado por 1K tokens (metadatos de routing; no factura nada aquí). */
  costPer1kUsd?: { input: number; output: number };
  /** Nombre de la env var que habilita el proveedor (Slice 3). */
  apiKeyEnv: string;
};

/** Catálogo de SLOTS. Solo metadatos de routing; NINGÚN cliente instanciado. */
export const MODEL_SLOTS: ModelSlot[] = [
  {
    id: "anthropic:opus",
    provider: "anthropic",
    model: "claude-opus-4-7",
    capabilities: ["tool_use", "long_context", "reasoning"],
    costPer1kUsd: { input: 0.015, output: 0.075 },
    apiKeyEnv: "ANTHROPIC_API_KEY"
  },
  {
    id: "anthropic:sonnet",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    capabilities: ["tool_use", "long_context", "cheap"],
    costPer1kUsd: { input: 0.003, output: 0.015 },
    apiKeyEnv: "ANTHROPIC_API_KEY"
  },
  // Slots reservados para Slice 3 — NO activos, NO se llaman. `available` será
  // false salvo que exista la key, y aun así Slice 2c no los invoca.
  { id: "openai:gpt", provider: "openai", model: "gpt-5", capabilities: ["tool_use", "reasoning"], apiKeyEnv: "OPENAI_API_KEY" },
  { id: "gemini:pro", provider: "gemini", model: "gemini-pro", capabilities: ["tool_use", "long_context", "vision"], apiKeyEnv: "GEMINI_API_KEY" },
  { id: "perplexity:sonar", provider: "perplexity", model: "sonar", capabilities: ["web_search"], apiKeyEnv: "PERPLEXITY_API_KEY" }
];

export type ProviderHealth = "available" | "unavailable";

/** Salud SIN red: hay key en el env → available; si no → unavailable. */
export function slotHealth(slot: ModelSlot, env: NodeJS.ProcessEnv = process.env): ProviderHealth {
  return env[slot.apiKeyEnv] && String(env[slot.apiKeyEnv]).trim() ? "available" : "unavailable";
}

export type RoutingNeed = { capabilities?: Capability[]; preferCheap?: boolean; excludeProviders?: ProviderId[] };

/**
 * Enruta a los slots DISPONIBLES que cumplen la capacidad, ordenados por coste si
 * se pide. Devuelve solo metadatos (Slice 3 los convertirá en adaptadores).
 * Nunca lanza por proveedor ausente: simplemente no lo incluye.
 */
export function routeSlots(need: RoutingNeed, env: NodeJS.ProcessEnv = process.env): ModelSlot[] {
  const caps = need.capabilities ?? [];
  const out = MODEL_SLOTS.filter((s) => {
    if (slotHealth(s, env) !== "available") return false;
    if (need.excludeProviders?.includes(s.provider)) return false;
    return caps.every((c) => s.capabilities.includes(c));
  });
  if (need.preferCheap) {
    out.sort((a, b) => (a.costPer1kUsd?.output ?? Infinity) - (b.costPer1kUsd?.output ?? Infinity));
  }
  return out;
}

/** Los proveedores disponibles como pares {provider, model} para `strategy.ts`. */
export function availableProviders(env: NodeJS.ProcessEnv = process.env): { provider: string; model: string }[] {
  return MODEL_SLOTS.filter((s) => slotHealth(s, env) === "available").map((s) => ({ provider: s.provider, model: s.model }));
}
