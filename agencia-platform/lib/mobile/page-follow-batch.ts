import { z } from "zod";

/** Máximo de páginas por encargo: cabe en el lease de 10 min con pausas entre páginas. */
export const MAX_PAGE_FOLLOW_TARGETS = 25;
export const MAX_PAGE_FOLLOW_BATCH_TEXT = 24_000;
export const PAGE_FOLLOW_PLATFORMS = ["facebook", "instagram", "tiktok"] as const;
export type PageFollowPlatform = (typeof PAGE_FOLLOW_PLATFORMS)[number];

export const pageFollowOutcomeSchema = z.enum(["pending", "followed", "already_following", "failed"]);
export type PageFollowOutcome = z.infer<typeof pageFollowOutcomeSchema>;

export const pageFollowTargetSchema = z.object({
  id: z.string().trim().min(1).max(40),
  url: z.string().trim().url().max(2048),
  outcome: pageFollowOutcomeSchema,
  detail: z.string().trim().max(500).nullable()
}).strict();

export const pageFollowBatchSchema = z.object({
  kind: z.literal("page_follow"),
  version: z.literal(1),
  platform: z.enum(PAGE_FOLLOW_PLATFORMS),
  pages: z.array(pageFollowTargetSchema).min(1).max(MAX_PAGE_FOLLOW_TARGETS)
}).strict();

export type PageFollowTarget = z.infer<typeof pageFollowTargetSchema>;
export type PageFollowBatch = z.infer<typeof pageFollowBatchSchema>;

const PROFILE_BASE: Record<PageFollowPlatform, (handle: string) => string> = {
  facebook: (handle) => `https://www.facebook.com/${handle}`,
  instagram: (handle) => `https://www.instagram.com/${handle}/`,
  tiktok: (handle) => `https://www.tiktok.com/@${handle}`
};

/**
 * Convierte lo que escribe el usuario (una página por línea, o separadas por comas)
 * en URLs HTTPS. Acepta URL completa, dominio sin protocolo o @usuario / usuario.
 * No valida el dominio: eso lo hace validateAutomationTargetUrl en la política.
 */
export function normalizePageFollowEntries(platform: PageFollowPlatform, raw: string | readonly string[]): string[] {
  const entries = (typeof raw === "string" ? raw.split(/[\n,;]+/) : raw)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    let url: string;
    if (/^https?:\/\//i.test(entry)) url = entry.replace(/^http:\/\//i, "https://");
    else if (/^(?:[\w-]+\.)+[a-z]{2,}\//i.test(entry) || /^(?:[\w-]+\.)*(?:facebook|fb|instagram|tiktok)\.(?:com|me)$/i.test(entry)) url = `https://${entry}`;
    else {
      const handle = entry.replace(/^@/, "");
      if (!/^[\p{L}\p{N}._-]{2,80}$/u.test(handle)) {
        throw new Error(`«${entry.slice(0, 60)}» no es una URL ni un nombre de usuario válido.`);
      }
      url = PROFILE_BASE[platform](handle);
    }
    const key = url.toLocaleLowerCase("es").replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
  }
  return urls;
}

export function createPageFollowBatch(platform: PageFollowPlatform, urls: readonly string[]): PageFollowBatch {
  if (urls.length === 0) throw new Error("Añade al menos una página para seguir.");
  if (urls.length > MAX_PAGE_FOLLOW_TARGETS) throw new Error(`El máximo es de ${MAX_PAGE_FOLLOW_TARGETS} páginas por encargo.`);
  return pageFollowBatchSchema.parse({
    kind: "page_follow",
    version: 1,
    platform,
    pages: urls.map((url, index) => ({ id: `p${index + 1}`, url, outcome: "pending", detail: null }))
  });
}

export function parsePageFollowBatch(text: string): PageFollowBatch {
  if (text.length > MAX_PAGE_FOLLOW_BATCH_TEXT) throw new Error("El lote de páginas es demasiado grande.");
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error("El lote de páginas no es JSON válido."); }
  return pageFollowBatchSchema.parse(json);
}

export function serializePageFollowBatch(batch: PageFollowBatch): string {
  return JSON.stringify(pageFollowBatchSchema.parse(batch));
}

export function isPageFollowBatchText(text: string | null | undefined): boolean {
  if (!text) return false;
  try { return (JSON.parse(text) as { kind?: unknown })?.kind === "page_follow"; } catch { return false; }
}

/** El resultado del móvil solo puede cambiar outcome/detail, nunca la lista de páginas. */
export function samePageFollowTargets(a: PageFollowBatch, b: PageFollowBatch): boolean {
  return a.platform === b.platform
    && a.pages.length === b.pages.length
    && a.pages.every((page, index) => page.id === b.pages[index]!.id && page.url === b.pages[index]!.url);
}

export function pageFollowSummary(batch: PageFollowBatch): { done: number; pending: number; failed: number } {
  const done = batch.pages.filter((page) => page.outcome === "followed" || page.outcome === "already_following").length;
  const failed = batch.pages.filter((page) => page.outcome === "failed").length;
  return { done, failed, pending: batch.pages.length - done - failed };
}
