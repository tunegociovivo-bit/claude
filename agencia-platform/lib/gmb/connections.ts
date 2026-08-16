/**
 * Estado de CONEXIONES del GMB Hub — PURO. A partir de FLAGS booleanos (nunca claves) construye el
 * panel de conexiones y un checklist de puesta en marcha. Jamás expone secretos.
 */
export type ConnectionFlags = {
  gbp: boolean; // Google Business Profile (API directa vía Google OAuth)
  maps: boolean; // Google Maps (rank grid, competencia)
  make: boolean; // Make (ingesta de reseñas + publicación de respuestas)
  anthropic: boolean;
  openai: boolean;
  gemini: boolean;
  perplexity: boolean;
};

export type ConnectionStatus = { id: string; name: string; connected: boolean; scope: string; note: string; envVar?: string };

export function buildConnections(flags: ConnectionFlags): ConnectionStatus[] {
  return [
    { id: "gbp", name: "Google Business Profile", connected: flags.gbp, scope: "publicar posts, responder reseñas (API directa)", note: flags.gbp ? "Conectado por OAuth de Google." : "Sin conectar: conecta la cuenta de Google (scope business.manage) para publicar/responder por API.", envVar: "GOOGLE OAuth (GoogleAdsConnection)" },
    { id: "maps", name: "Google Maps", connected: flags.maps, scope: "rank grid y competencia", note: flags.maps ? "Clave de Maps configurada." : "Sin conectar: el Rank Grid queda bloqueado (no se miden posiciones).", envVar: "GOOGLE_MAPS_API_KEY" },
    { id: "make", name: "Make (Integromat)", connected: flags.make, scope: "ingesta de reseñas + publicar respuestas", note: flags.make ? "Webhooks de Make configurados." : "Sin conectar: configura los webhooks de Make en Ajustes de la ficha.", envVar: "settings.integrations.gmb" },
    { id: "anthropic", name: "Claude (Anthropic)", connected: flags.anthropic, scope: "AI Council / borradores", note: flags.anthropic ? "Clave configurada." : "Sin conectar.", envVar: "ANTHROPIC_API_KEY" },
    { id: "openai", name: "OpenAI (ChatGPT)", connected: flags.openai, scope: "AI Council / generación", note: flags.openai ? "Clave configurada." : "Sin conectar.", envVar: "OPENAI_API_KEY" },
    { id: "gemini", name: "Gemini (Google)", connected: flags.gemini, scope: "AI Council", note: flags.gemini ? "Clave configurada." : "Sin conectar.", envVar: "GEMINI_API_KEY" },
    { id: "perplexity", name: "Perplexity", connected: flags.perplexity, scope: "AI Council (búsqueda web)", note: flags.perplexity ? "Clave configurada." : "Sin conectar.", envVar: "PERPLEXITY_API_KEY" }
  ];
}

export type ChecklistItem = { label: string; done: boolean; hint: string };

/** Checklist de puesta en marcha a partir del estado de conexiones. */
export function buildOnboardingChecklist(flags: ConnectionFlags): ChecklistItem[] {
  return [
    { label: "Conectar Make para reseñas", done: flags.make, hint: "Sin Make no entran reseñas ni se publican respuestas." },
    { label: "Conectar Google Maps", done: flags.maps, hint: "Necesario para el Rank Grid y la comparación de competencia." },
    { label: "Conectar Google Business Profile", done: flags.gbp, hint: "Para publicar posts y responder reseñas por API (opcional; Make cubre respuestas)." },
    { label: "Configurar al menos un modelo de IA", done: flags.anthropic || flags.openai || flags.gemini || flags.perplexity, hint: "Habilita el AI Council y los borradores asistidos." }
  ];
}

export function connectionsSummary(flags: ConnectionFlags): { connected: number; total: number } {
  const vals = Object.values(flags);
  return { connected: vals.filter(Boolean).length, total: vals.length };
}
