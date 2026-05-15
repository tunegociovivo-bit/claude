/**
 * Helpers para extraer mensajes legibles de errores de proveedores IA.
 * Convierte errores tipo:
 *   "400 {"type":"error","error":{"message":"Your credit balance is too low..."}}"
 * en mensajes humanos sin JSON crudo.
 */

export function humanizeAiError(e: any): { message: string; code: string } {
  const raw = String(e?.message ?? e ?? "");

  // Intentar parsear JSON anidado (formato Anthropic SDK + OpenAI HTTP)
  const jsonMatch = raw.match(/\{.*\}/s);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const inner =
        parsed?.error?.message ?? parsed?.error?.error?.message ?? parsed?.message ?? null;
      if (typeof inner === "string" && inner.length > 0) {
        return mapKnownMessage(inner);
      }
    } catch {}
  }

  return mapKnownMessage(raw);
}

function mapKnownMessage(msg: string): { message: string; code: string } {
  const lower = msg.toLowerCase();

  if (lower.includes("credit balance is too low") || lower.includes("billing")) {
    return {
      code: "ai_no_credits",
      message:
        "Tu cuenta de Anthropic no tiene saldo. Carga créditos en https://console.anthropic.com/settings/billing y vuelve a intentarlo."
    };
  }
  if (lower.includes("invalid api key") || lower.includes("invalid_api_key") || lower.includes("authentication")) {
    return {
      code: "ai_bad_key",
      message: "La API key de IA configurada no es válida. Revísala en /admin/ai."
    };
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return {
      code: "ai_rate_limit",
      message: "Anthropic está limitando peticiones (rate limit). Espera unos segundos y reintenta."
    };
  }
  if (lower.includes("overloaded")) {
    return {
      code: "ai_overloaded",
      message: "El servicio de IA está saturado en este momento. Reintenta en unos minutos."
    };
  }
  if (lower.includes("context_length") || lower.includes("max_tokens") || lower.includes("too long")) {
    return {
      code: "ai_too_long",
      message: "La petición es demasiado larga. Acorta el brief o reduce el número de publicaciones."
    };
  }
  if (lower.includes("safety") || lower.includes("policy") || lower.includes("blocked")) {
    return {
      code: "ai_blocked",
      message: "El contenido fue bloqueado por las políticas de uso de la IA. Reformula la instrucción."
    };
  }
  if (lower.startsWith("storage no configurado")) {
    return { code: "storage_disabled", message: msg };
  }

  // Por defecto: cortar y devolver
  return { code: "ai_error", message: msg.slice(0, 300) };
}
