// Catálogo de "herramientas" que se pueden permitir/restringir por
// usuario. Cada key cuelga de una sección de la plataforma. Las features
// admin-only (gestión de usuarios, API keys, MRR…) NO están aquí — se
// gobiernan por el role, no por esta lista.

export const FEATURES = [
  "inicio",
  "tareas",
  "clientes",
  "documentos",
  "databases",
  "calendario",
  "editorial",
  "ia"
] as const;

export type Feature = (typeof FEATURES)[number];

export const FEATURE_LABEL: Record<Feature, string> = {
  inicio: "Inicio (dashboard)",
  tareas: "Tareas y proyectos",
  clientes: "Clientes (CRM)",
  documentos: "Documentos / Wiki",
  databases: "Bases de datos",
  calendario: "Calendario",
  editorial: "Calendario editorial",
  ia: "Asistente IA (Hub)"
};

export const FEATURE_DESCRIPTION: Record<Feature, string> = {
  inicio: "Panel resumen con próximas tareas y eventos.",
  tareas: "Tableros Kanban, lista de tareas y proyectos.",
  clientes: "Listado y fichas de clientes, accesos y servicios.",
  documentos: "Wiki interna estilo Notion con páginas y subpáginas.",
  databases: "Bases de datos personalizadas con vistas tabla/board/calendario.",
  calendario: "Calendario de equipo y eventos.",
  editorial: "Calendario editorial, publicaciones planificadas, exportar a Metricool.",
  ia: "Chatear con Hub, redactor de copy, generación de contenido editorial."
};

// Defaults para cada rol cuando el miembro NO tiene una lista explícita.
const ALL: Feature[] = [...FEATURES];
// Member: todas las herramientas operativas (sigue sin ver lo admin-only,
// que es independiente — MRR, API keys, gestión de equipo, etc.).
const MEMBER_DEFAULT: Feature[] = [...FEATURES];
// Guest: sólo lectura — cubrimos las vistas estándar, no editorial ni IA.
const GUEST_DEFAULT: Feature[] = ["inicio", "tareas", "clientes", "documentos", "databases", "calendario"];

export function defaultFeaturesForRole(role: "ADMIN" | "MEMBER" | "GUEST"): Feature[] {
  if (role === "ADMIN") return ALL;
  if (role === "GUEST") return GUEST_DEFAULT;
  return MEMBER_DEFAULT;
}

// Calcula las features efectivas de un miembro a partir de su role y de
// la lista explícita guardada en Membership.features (puede ser null,
// array, o "any" si vino de un Json sin tipar).
export function effectiveFeatures(role: "ADMIN" | "MEMBER" | "GUEST", featuresJson: unknown): Feature[] {
  if (role === "ADMIN") return ALL;
  if (Array.isArray(featuresJson)) {
    const valid = featuresJson.filter((k): k is Feature => typeof k === "string" && (FEATURES as readonly string[]).includes(k));
    return valid;
  }
  return defaultFeaturesForRole(role);
}

export function hasFeature(features: Feature[] | undefined | null, key: Feature): boolean {
  if (!features) return false;
  return features.includes(key);
}
