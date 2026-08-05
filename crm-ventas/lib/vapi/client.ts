import "server-only";

type VapiPhone = { id: string; number?: string; provider?: string };

export class VapiApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 502) {
    super(message);
  }
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
      const message = typeof body?.message === "string" ? body.message : "Vapi no pudo completar la operación";
      throw new VapiApiError(`VAPI_${response.status}`, message, response.status >= 500 ? 502 : 400);
    }
    return response.json();
  } catch (error) {
    if (error instanceof VapiApiError) throw error;
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
