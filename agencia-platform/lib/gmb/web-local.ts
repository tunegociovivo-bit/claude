/**
 * Web local — recomendaciones PURAS y BORRADORES auditables: páginas/servicios locales, entidades y
 * datos estructurados (schema.org LocalBusiness JSON-LD) coherentes con la ficha de Google. No
 * aplica cambios externos: genera propuestas y un borrador de schema para revisar/pegar.
 */
import type { Nap } from "./nap";

export type WebRecommendation = { type: "page" | "service" | "entity" | "schema"; title: string; detail: string; impact: number };

export function webRecommendations(opts: { category?: string | null; keyword?: string | null; city?: string | null; hasWebsite: boolean }): WebRecommendation[] {
  const cat = (opts.category ?? "servicios").trim() || "servicios";
  const city = (opts.city ?? "").trim();
  const kw = (opts.keyword ?? cat).trim();
  const out: WebRecommendation[] = [];
  if (!opts.hasWebsite) out.push({ type: "page", title: "Crear web/landing local", detail: "La ficha no tiene web. Una landing con NAP, servicios y reseñas mejora la conversión y el SEO local.", impact: 70 });
  out.push({ type: "page", title: `Página de servicio: ${kw}${city ? ` en ${city}` : ""}`, detail: `Crea una página específica optimizada para "${kw}${city ? ` ${city}` : ""}" con contenido local, FAQ y llamada a la acción.`, impact: 65 });
  out.push({ type: "service", title: "Listado de servicios coherente con GBP", detail: "Alinea los servicios de la web con los de la ficha de Google para reforzar la relevancia.", impact: 50 });
  out.push({ type: "entity", title: "Entidades y NAP consistentes", detail: "Asegura que nombre, dirección y teléfono de la web coinciden EXACTAMENTE con el NAP canónico.", impact: 55 });
  out.push({ type: "schema", title: "Datos estructurados LocalBusiness", detail: "Añade JSON-LD LocalBusiness con dirección, teléfono, horario y geo para enriquecer los resultados.", impact: 60 });
  return out.sort((a, b) => b.impact - a.impact);
}

/** Borrador de schema.org LocalBusiness (JSON-LD) a partir del NAP canónico. Auditable, no se aplica. */
export function buildLocalBusinessSchema(opts: { nap: Nap; category?: string | null; city?: string | null; lat?: number | null; lng?: number | null }): Record<string, any> {
  const schema: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: opts.nap.name ?? "",
    telephone: opts.nap.phone ?? "",
    url: opts.nap.website ? (/^https?:/i.test(opts.nap.website) ? opts.nap.website : `https://${opts.nap.website}`) : undefined,
    address: { "@type": "PostalAddress", streetAddress: opts.nap.address ?? "", addressLocality: opts.city ?? "", addressCountry: "ES" }
  };
  if (opts.category) schema["@type"] = "LocalBusiness"; // categoría específica se puede afinar manualmente
  if (typeof opts.lat === "number" && typeof opts.lng === "number") schema.geo = { "@type": "GeoCoordinates", latitude: opts.lat, longitude: opts.lng };
  // Limpia undefined para un JSON-LD limpio.
  return JSON.parse(JSON.stringify(schema));
}
