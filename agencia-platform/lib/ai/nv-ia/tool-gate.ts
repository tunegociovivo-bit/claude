/**
 * Gate server-side OBLIGATORIO para tools mutantes peligrosas de la IA (Sonia).
 * FASE 1 · Punto 3.
 *
 * PROBLEMA: el bucle de dispatch (runner.ts) ejecuta cualquier tool que el modelo
 * pida sin consultar riesgo. Varias tools de ejecución DIRECTA (no pasan por el
 * sistema de borradores AiDraft) golpean APIs externas al instante: envío de
 * WhatsApp, reembolsos Stripe, facturas Holded, y `make_raw_api` con método
 * mutante (incl. DELETE). El único "riesgo" existente (request_user_approval)
 * es un valor que declara EL PROPIO MODELO y solo se consulta si el modelo elige
 * llamarlo. Un prompt-injection basta para auto-calificarse "low" y ejecutar.
 *
 * SOLUCIÓN: clasificación de peligro AUTORÍA DEL SERVIDOR (esta lista, no el
 * modelo) aplicada en el choke point de dispatch. Las tools peligrosas NO se
 * ejecutan de forma autónoma: se devuelve al modelo un resultado de error
 * "requires_human_approval" para que use la vía de borrador/aprobación humana.
 *
 * Reversibilidad (env `AI_TOOL_GATE`):
 *   - "enforce" (POR DEFECTO): bloquea las tools peligrosas (aprobación obligatoria).
 *   - "log":     no bloquea, solo registra lo que en enforce se bloquearía (shadow).
 *   - "off":     desactiva el gate (vuelta atrás inmediata).
 */

export type ToolGateMode = "off" | "log" | "enforce";

export function toolGateMode(env: NodeJS.ProcessEnv = process.env): ToolGateMode {
  const m = (env.AI_TOOL_GATE ?? "").trim().toLowerCase();
  if (m === "off" || m === "log" || m === "enforce") return m;
  return "enforce"; // obligatorio por defecto: son acciones de dinero/mensajería
}

/**
 * Tools de ejecución directa que causan efectos externos/irreversibles y NO
 * pasan por AiDraft. Valor = categoría legible (dinero / mensajería / …).
 */
export const DANGEROUS_TOOLS: Record<string, string> = {
  // Mensajería externa (se envía al instante, sin borrador AiDraft).
  send_whatsapp_message: "mensajería externa (WhatsApp)",
  send_whatsapp_voice: "mensajería externa (WhatsApp voz)",
  send_email: "mensajería externa (email/Resend)",
  // Dinero: cobros, reembolsos, facturación.
  stripe_refund_charge: "dinero (reembolso Stripe)",
  stripe_create_customer: "dinero (cliente Stripe)",
  stripe_create_subscription: "dinero (suscripción recurrente Stripe)",
  holded_create_invoice: "dinero (factura Holded)",
  holded_create_quote: "dinero (presupuesto Holded)",
  // Dinero: gasto publicitario (crear campañas / presupuestos compromete inversión).
  meta_ads_create_campaign: "dinero (campaña Meta Ads)",
  meta_ads_create_lead_campaign: "dinero (campaña de leads Meta Ads)",
  meta_ads_create_ad: "dinero (anuncio Meta Ads)",
  meta_ads_bulk_update_campaigns: "dinero (cambio masivo de campañas Meta Ads)",
  google_ads_create_campaign: "dinero (campaña Google Ads)",
  google_ads_create_budget: "dinero (presupuesto Google Ads)",
  // Automatización externa (Make).
  make_create_scenario: "automatización (crear escenario Make)",
  make_activate_scenario: "automatización (activar escenario Make)",
  make_deactivate_scenario: "automatización (desactivar escenario Make)"
  // make_raw_api se evalúa por método (ver toolDanger).
  // NOTA: las tools de PUBLICACIÓN de contenido (wp_create_post, gmb_create_post,
  // sheets_update_range, woocommerce_create_product…) NO se gatean aquí a
  // propósito: no son dinero/mensajería y gatearlas rompería flujos editoriales
  // autónomos. Revisar en FASE 2 si se quiere aprobación también para publicación.
};

// Métodos HTTP no mutantes: make_raw_api con estos no requiere aprobación.
const MAKE_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * ¿Es peligrosa esta llamada? Devuelve la categoría (string) o null si es segura.
 * La decisión NO depende de ningún campo de riesgo suministrado por el modelo.
 */
export function toolDanger(name: string, input: unknown): string | null {
  if (name === "make_raw_api") {
    const method = String((input as any)?.method ?? "GET").toUpperCase();
    return MAKE_SAFE_METHODS.has(method) ? null : `Make API método mutante (${method})`;
  }
  return DANGEROUS_TOOLS[name] ?? null;
}

/** Mensaje de bloqueo devuelto al modelo cuando el gate está en enforce. */
export function blockedToolResult(name: string, reason: string) {
  return {
    error: "requires_human_approval",
    tool: name,
    reason,
    message:
      `Acción bloqueada por política de seguridad: la tool "${name}" (${reason}) NO se ejecuta de ` +
      `forma autónoma. Crea un borrador (AiDraft) para que un humano lo apruebe, o usa ` +
      `request_user_approval y ESPERA la aprobación; no reintentes la ejecución directa.`
  };
}
