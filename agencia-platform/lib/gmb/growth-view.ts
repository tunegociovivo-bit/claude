/**
 * Resolución del CONTENIDO de demo por pestaña del Centro de crecimiento. Fuente única para la UI
 * y para el test parametrizado que garantiza que ninguna de las 9 pestañas queda vacía en demo.
 */
import { GROWTH_DEMO } from "./growth-demo";

export type GrowthTab = "presencia" | "aicouncil" | "rank" | "contenido" | "reseñas" | "web" | "informes" | "citaciones" | "acciones";
export const GROWTH_TABS: GrowthTab[] = ["presencia", "aicouncil", "rank", "contenido", "reseñas", "web", "informes", "citaciones", "acciones"];

/** Nº de elementos visibles que la demo de cada pestaña renderiza (>0 = no vacía). */
export function demoPanelCount(tab: GrowthTab): number {
  const d = GROWTH_DEMO;
  switch (tab) {
    case "presencia": return 1 /*score*/ + d.presence.opportunities.length + Object.keys(d.presence.breakdown).length;
    case "aicouncil": return d.aiCouncil.providers.length + d.aiCouncil.exampleRun.proposals.length + d.aiCouncil.exampleRun.discrepancies.length;
    case "rank": return d.rank.keywords.length + (d.rank.gap ? 1 : 0);
    case "contenido": return d.content.ideas.length + 1 /*cadence*/;
    case "reseñas": return d.reviews.items.length + (d.reviews.summary.total > 0 ? 1 : 0);
    case "web": return d.web.recommendations.length + (d.web.schema ? 1 : 0);
    case "informes": return 1; // tarjeta estática con CTA al informe imprimible (siempre visible)
    case "citaciones": return d.citations.citations.length;
    case "acciones": return d.actions.actions.length;
  }
}

export function demoPanelVisible(tab: GrowthTab): boolean {
  return demoPanelCount(tab) > 0;
}
