import "server-only";

type VapiPhone = { id: string; number?: string; provider?: string };

export class VapiApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 502) {
    super(message);
  }
}

const MAX_ERROR_DETAIL_LENGTH = 300;

// Cualquier texto que devuelva Vapi puede citar credenciales que nosotros
// mismos enviamos (Account SID, tokens); se enmascaran antes de guardar o
// registrar nada. Los cuerpos de petición no se registran nunca.
function redactSecrets(text: string): string {
  return text
    .replace(/AC[0-9a-fA-F]{32}/g, "AC…[oculto]")
    .replace(/\b[0-9a-fA-F]{30,}\b/g, "[oculto]")
    .replace(/Bearer\s+\S+/gi, "Bearer [oculto]");
}

function collectMessages(value: unknown, depth = 0): string[] {
  if (value == null || depth > 3) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectMessages(item, depth + 1));
  if (typeof value === "object") {
    return ["message", "error", "errors", "issues", "detail", "details"].flatMap((key) =>
      key in (value as Record<string, unknown>) ? collectMessages((value as Record<string, unknown>)[key], depth + 1) : []
    );
  }
  return [];
}

// Formas habituales de error de Vapi: { message: string | string[] },
// { error: { message } }, { errors: [...] } o { issues: [...] }.
export function extractVapiErrorDetail(body: unknown): string | null {
  const messages = Array.from(new Set(collectMessages(body)));
  if (!messages.length) return null;
  const detail = redactSecrets(messages.join(" · "));
  return detail.length > MAX_ERROR_DETAIL_LENGTH ? `${detail.slice(0, MAX_ERROR_DETAIL_LENGTH - 1)}…` : detail;
}

async function vapiFetch(path: string, init: RequestInit): Promise<any> {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) throw new VapiApiError("VAPI_NOT_CONFIGURED", "Vapi no está configurado", 503);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`https://api.vapi.ai${path}`, {
      ...init,
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...init.headers },
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const detail = extractVapiErrorDetail(body);
      const code = `VAPI_${response.status}`;
      console.error(`[vapi] ${init.method || "GET"} ${path} → ${response.status} (${code})${detail ? ` — ${detail}` : " — sin detalle en la respuesta"}`);
      const message = detail ? `Vapi rechazó la operación: ${detail}` : "Vapi no pudo completar la operación";
      throw new VapiApiError(code, message, response.status >= 500 ? 502 : 400);
    }
    return response.json();
  } catch (error) {
    if (error instanceof VapiApiError) throw error;
    console.error(`[vapi] ${init.method || "GET"} ${path} → fallo de red o timeout (${(error as Error)?.name || "Error"})`);
    throw new VapiApiError("VAPI_UNAVAILABLE", "No se pudo conectar con Vapi");
  } finally {
    clearTimeout(timer);
  }
}

export async function createManagedPhone(areaCode: string, name?: string): Promise<VapiPhone> {
  return vapiFetch("/phone-number", {
    method: "POST",
    body: JSON.stringify({ provider: "vapi", numberDesiredAreaCode: areaCode, name: name || "CRM Ventas" }),
  });
}

export async function importTwilioPhone(input: {
  number: string;
  accountSid: string;
  authToken: string;
  name?: string;
}): Promise<VapiPhone> {
  return vapiFetch("/phone-number", {
    method: "POST",
    body: JSON.stringify({
      provider: "twilio",
      twilioPhoneNumber: input.number,
      twilioAccountSid: input.accountSid,
      twilioAuthToken: input.authToken,
      smsEnabled: false,
      name: input.name || "CRM Ventas",
    }),
  });
}

export async function configureInboundPhone(id: string, serverUrl: string): Promise<void> {
  await vapiFetch(`/phone-number/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ assistantId: null, server: { url: serverUrl } }),
  });
}
