/**
 * Elige la fuente de reseñas del detector: SerpApi (completa, con historial de perfiles) o,
 * si no hay key, Serper.dev reutilizando la key del Publicador SEO (sin historial de perfiles).
 */
import { SerpApiClient, getSerpApiKey, type ReviewSource } from "@/lib/integrations/serpapi";
import { SerperReviewsClient } from "@/lib/integrations/serper-reviews";
import { getSeoBlogSettings } from "@/lib/seo-blog/settings";

export class NoReviewSourceError extends Error {
  constructor() {
    super(
      "No hay proveedor de reseñas configurado. Añade una API key de SerpApi en GMB Hub → Ajustes, o la de Serper.dev en Publicador SEO → Ajustes."
    );
  }
}

export type SourceInfo = { provider: "serpapi" | "serper" | null; origin: string; supportsContributor: boolean };

export async function describeReviewSource(workspaceId: string): Promise<SourceInfo & { key: string | null }> {
  const serp = await getSerpApiKey(workspaceId).catch(() => null);
  if (serp) return { provider: "serpapi", origin: "SerpApi (GMB Hub → Ajustes)", supportsContributor: true, key: serp };
  const seo = await getSeoBlogSettings(workspaceId).catch(() => null);
  if (seo?.serperApiKey) return { provider: "serper", origin: "Serper.dev (clave del Publicador SEO)", supportsContributor: false, key: seo.serperApiKey };
  return { provider: null, origin: "", supportsContributor: false, key: null };
}

/** `cacheDays: 0` para lecturas que deben ser frescas (vigilancia diaria, comprobación de retiradas). */
export async function getReviewSource(workspaceId: string, opts: { cacheDays?: number } = {}): Promise<ReviewSource> {
  const d = await describeReviewSource(workspaceId);
  if (d.provider === "serpapi" && d.key) return new SerpApiClient(d.key, { cacheDays: opts.cacheDays });
  if (d.provider === "serper" && d.key) return new SerperReviewsClient(d.key, { cacheDays: opts.cacheDays });
  throw new NoReviewSourceError();
}
