/**
 * Router de modelo Claude para Sonia — opcional, OFF por defecto.
 *
 * Anthropic factura por tokens y modelo:
 *   - Opus 4.7:    $15 IN / $75 OUT por 1M tokens
 *   - Sonnet 4.6:  $3 IN / $15 OUT  (5× más barato)
 *   - Haiku 4.5:   $0.80 IN / $4 OUT (15× más barato)
 *
 * NO todas las tareas necesitan Opus. Tasks como "responde un email
 * con OK" o "etiqueta esta task" pueden hacerlas Haiku perfectamente,
 * pagando 1/15 del coste.
 *
 * Activar añadiendo en Workspace.settings.aiAgent.modelRouting = "auto":
 *
 *   - "always_opus" (default): igual que antes, todo Opus 4.7.
 *   - "auto": clasifica cada task por heurística y elige modelo.
 *   - "cost_saver": agresivo, Haiku salvo que la task contenga
 *     keywords claras de complejidad.
 *
 * Override per-task: si la description de la task contiene
 * "[model:opus]" / "[model:sonnet]" / "[model:haiku]" se respeta.
 */

export type ModelRouting = "always_opus" | "auto" | "cost_saver";

export type ClaudeModel = "claude-opus-4-7" | "claude-sonnet-4-6" | "claude-haiku-4-5";

const HEAVY_KEYWORDS = [
  // Marketing complejo
  "informe",
  "report",
  "campaña",
  "campaign",
  "análisis",
  "analisis",
  "investigación",
  "investiga",
  "competidor",
  "auditoría",
  "auditoria",
  "estrategia",
  "diagnóstico",
  "diagnostico",
  // Datos / ads
  "meta ads",
  "google ads",
  "ga4",
  "search console",
  "métricas",
  "metricas",
  "leads",
  "kpi",
  "roas",
  "cpa",
  "cpl",
  // Creación grande
  "calendario editorial",
  "informe mensual",
  "informe semanal",
  "30 posts",
  "redacta el plan",
  "diseña",
  "creativos",
  // Coordinación / múltiples pasos
  "varios clientes",
  "todos los clientes",
  "para cada"
];

const LIGHT_KEYWORDS = [
  "responde",
  "contesta",
  "responder",
  "envía un",
  "envia un",
  "manda un",
  "etiqueta",
  "marca como",
  "cambia estado",
  "cierra esta",
  "marca completa",
  "agradece",
  "comenta",
  "saluda",
  "confirma",
  "recordatorio simple",
  "ok",
  "👍",
  "sí",
  "no",
  "duda rápida",
  "pregunta corta"
];

export function parseModelOverride(text: string | null | undefined): ClaudeModel | null {
  if (!text) return null;
  const m = /\[model:(opus|sonnet|haiku)\]/i.exec(text);
  if (!m) return null;
  switch (m[1].toLowerCase()) {
    case "opus":
      return "claude-opus-4-7";
    case "sonnet":
      return "claude-sonnet-4-6";
    case "haiku":
      return "claude-haiku-4-5";
  }
  return null;
}

export function pickModelForTask(opts: {
  routing: ModelRouting;
  title: string;
  description: string | null | undefined;
  /** Default si no se decide nada con heurística */
  fallback: ClaudeModel;
}): { model: ClaudeModel; reason: string } {
  const overrideText = `${opts.title}\n${opts.description ?? ""}`;
  const override = parseModelOverride(overrideText);
  if (override) return { model: override, reason: "override [model:...] en la task" };

  if (opts.routing === "always_opus") {
    return { model: "claude-opus-4-7", reason: "always_opus" };
  }

  const text = `${opts.title}\n${opts.description ?? ""}`.toLowerCase();
  const len = text.length;
  const heavyHits = HEAVY_KEYWORDS.filter((k) => text.includes(k)).length;
  const lightHits = LIGHT_KEYWORDS.filter((k) => text.includes(k)).length;

  // Reglas comunes a auto y cost_saver:
  if (heavyHits >= 2) {
    return { model: "claude-opus-4-7", reason: `heavy×${heavyHits}` };
  }
  if (heavyHits === 1 && len > 400) {
    return { model: "claude-opus-4-7", reason: `heavy×1 + long(${len})` };
  }
  if (heavyHits === 1) {
    return { model: "claude-sonnet-4-6", reason: "heavy×1" };
  }

  if (opts.routing === "cost_saver") {
    // Agresivo: salvo lo claramente complejo, Haiku.
    if (lightHits > 0 || len < 200) {
      return { model: "claude-haiku-4-5", reason: `cost_saver light or short(${len})` };
    }
    if (len < 600) {
      return { model: "claude-sonnet-4-6", reason: `cost_saver medium(${len})` };
    }
    return { model: "claude-opus-4-7", reason: `cost_saver long(${len})` };
  }

  // "auto" — conservador: solo Haiku si claramente trivial
  if (lightHits >= 2 || (lightHits >= 1 && len < 150)) {
    return { model: "claude-haiku-4-5", reason: `auto light×${lightHits} short(${len})` };
  }
  if (len < 350) {
    return { model: "claude-sonnet-4-6", reason: `auto medium(${len})` };
  }
  return { model: opts.fallback, reason: "auto fallback (no hints fuertes)" };
}
