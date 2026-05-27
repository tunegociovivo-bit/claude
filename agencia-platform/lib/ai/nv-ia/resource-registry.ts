/**
 * Resource Registry — estado persistente de recursos creados por Sonia
 * por task. Sirve dos propósitos críticos:
 *
 * 1) IDEMPOTENCIA: antes de crear un recurso (campaña Meta, escenario
 *    Make, post editorial...), Sonia consulta este registro. Si la
 *    misma task ya creó uno equivalente, lo REUTILIZA en lugar de
 *    crear duplicado.
 *
 *    Ejemplo: re-run de "campaña Meta Despidos RS Advocats" tras
 *    fallar a mitad. Sin registry creabas campaña #2, #3, ... — con
 *    registry encuentras la #1 y completas lo que faltaba.
 *
 * 2) SELF-VERIFICATION: al final del run, Sonia puede leer este
 *    registro para reportar EXACTAMENTE qué creó/modificó. No
 *    confía en su memoria, mira la auditoría.
 *
 * Storage: Task.aiState (Json?) con shape:
 *   { meta_ads: {...}, make: {...}, ... }
 *
 * Cada integración mantiene su propio sub-mapa. Las claves dentro
 * son por convención (ver tipos abajo).
 */

import { prisma } from "@/lib/db/prisma";

type MetaAdsResources = {
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  formId?: string;
  imageHash?: string;
  creativeId?: string;
  adId?: string;
  /** Ads creados por adset en esta task: { adsetId: adId }. Permite
   *  añadir variantes (vídeo, carrusel, remarketing) en adsets distintos
   *  sin que el dedupe devuelva siempre el primer ad. */
  adIdsByAdset?: Record<string, string>;
  /** ID del ad account donde se crearon (para sanity checks). */
  adAccountId?: string;
};

type MakeResources = {
  /** ID del escenario duplicado por esta task. */
  scenarioId?: number;
  /** ID del webhook FB Lead Ads creado para este escenario. */
  hookId?: number;
  /** ID del escenario plantilla del que se clonó. */
  templateScenarioId?: number;
};

type EditorialResources = {
  /** Ids de posts editoriales creados por esta task. */
  postIds?: string[];
};

export type AiTaskState = {
  meta_ads?: MetaAdsResources;
  make?: MakeResources;
  editorial?: EditorialResources;
  /** Timestamp del último registro, util para debugging. */
  updatedAt?: string;
};

export async function readResources(taskId: string): Promise<AiTaskState> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { aiState: true } as any
  });
  const state = ((task as any)?.aiState as AiTaskState | null) ?? {};
  return state;
}

/**
 * Merge profundo (por sub-mapa) de los recursos pasados con los ya
 * registrados. NO sobrescribe values existentes con undefined.
 */
export async function recordResources(
  taskId: string,
  patch: Partial<AiTaskState>
): Promise<AiTaskState> {
  const current = await readResources(taskId);
  const merged: AiTaskState = { ...current };
  for (const key of Object.keys(patch) as Array<keyof AiTaskState>) {
    const sub = patch[key];
    if (sub && typeof sub === "object") {
      // shallow merge dentro del sub-mapa
      merged[key] = { ...(current[key] as any), ...(sub as any) } as any;
    }
  }
  merged.updatedAt = new Date().toISOString();
  await prisma.task.update({
    where: { id: taskId },
    data: { aiState: merged as any }
  });
  return merged;
}

/**
 * Resumen legible del state para inyectar al SYSTEM_PROMPT al inicio
 * del run. Si la task tiene recursos creados antes, Sonia los ve y
 * los reutiliza en lugar de crear duplicados.
 */
export function formatResourcesForPrompt(state: AiTaskState): string {
  const blocks: string[] = [];
  if (state.meta_ads && Object.keys(state.meta_ads).length > 0) {
    const m = state.meta_ads;
    const items: string[] = [];
    if (m.adAccountId) items.push(`adAccountId: ${m.adAccountId}`);
    if (m.campaignId) items.push(`campaignId: ${m.campaignId}${m.campaignName ? ` (${m.campaignName})` : ""}`);
    if (m.adsetId) items.push(`adsetId: ${m.adsetId}`);
    if (m.formId) items.push(`formId: ${m.formId}`);
    if (m.imageHash) items.push(`imageHash: ${m.imageHash}`);
    if (m.creativeId) items.push(`creativeId: ${m.creativeId}`);
    if (m.adId) items.push(`adId: ${m.adId}`);
    if (items.length > 0) blocks.push(`Meta Ads:\n  - ${items.join("\n  - ")}`);
  }
  if (state.make && Object.keys(state.make).length > 0) {
    const m = state.make;
    const items: string[] = [];
    if (m.scenarioId) items.push(`scenarioId: ${m.scenarioId}`);
    if (m.hookId) items.push(`hookId: ${m.hookId}`);
    if (m.templateScenarioId) items.push(`templateScenarioId (clonado de): ${m.templateScenarioId}`);
    if (items.length > 0) blocks.push(`Make:\n  - ${items.join("\n  - ")}`);
  }
  if (state.editorial?.postIds && state.editorial.postIds.length > 0) {
    blocks.push(`Editorial posts: ${state.editorial.postIds.join(", ")}`);
  }
  if (blocks.length === 0) return "";
  return [
    "",
    "## Recursos ya creados en runs anteriores de esta task (IDEMPOTENCIA)",
    "**REUTILÍZALOS en lugar de crear duplicados.** Si necesitas modificar algo, usa el id de aquí.",
    "Si vuelves a crear un recurso del mismo tipo te haré perder steps y crearás duplicados que el user tendrá que limpiar.",
    "",
    blocks.join("\n\n"),
    ""
  ].join("\n");
}

/**
 * Limpia el state. Útil cuando un humano edita la task (señal de
 * que el contexto cambió y los recursos viejos pueden no aplicar).
 */
export async function clearResources(taskId: string): Promise<void> {
  await prisma.task
    .update({ where: { id: taskId }, data: { aiState: null as any } })
    .catch(() => {});
}
