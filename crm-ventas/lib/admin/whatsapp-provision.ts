import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret, randomToken } from "@/lib/crypto";
import { assertAllowedWahaUrl, WahaUrlNotAllowedError } from "@/lib/waha";
import { derivedSessionName } from "@/lib/waha-connection";
import { patchWorkspaceSettings } from "@/lib/content/settings";
import { applyWhatsappServer, whatsappServerStatus, type WhatsappServerStatus } from "@/lib/admin/whatsapp-server";

export class WhatsappProvisionError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export type ProvisionInput =
  | { fromWorkspaceId: string; replace?: boolean }
  | { url: string; apiKey: string; replace?: boolean };

function allowedUrl(raw: string): string {
  try {
    return assertAllowedWahaUrl(raw);
  } catch (error) {
    if (error instanceof WahaUrlNotAllowedError) {
      throw new WhatsappProvisionError("Esa dirección no es un servidor de WhatsApp permitido (WAHA_ALLOWED_ORIGINS).", 400);
    }
    throw error;
  }
}

// Comprueba que el servidor responde y acepta la API key antes de guardarlo.
async function verifyServer(baseUrl: string, apiKey: string) {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/sessions?all=true`, {
      headers: { "X-Api-Key": apiKey },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new WhatsappProvisionError("No se pudo conectar con el servidor de WhatsApp. Revisa la dirección.", 502);
  }
  if (res.status === 401 || res.status === 403) {
    throw new WhatsappProvisionError("El servidor de WhatsApp rechaza esa API key.", 400);
  }
  if (!res.ok) throw new WhatsappProvisionError(`El servidor de WhatsApp respondió ${res.status}.`, 502);
}

// Activa (o cambia) el servidor de WhatsApp de un cliente: copiado de otro
// cliente que ya lo tiene, o con dirección y API key. La API key se guarda
// cifrada y nunca vuelve al navegador.
export async function provisionWhatsappServer(workspaceId: string, input: ProvisionInput): Promise<WhatsappServerStatus> {
  const target = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  if (!target) throw new WhatsappProvisionError("Cliente no encontrado", 404);
  const wasConfigured = whatsappServerStatus(target.settings).configured;
  if (wasConfigured && !input.replace) {
    throw new WhatsappProvisionError("Este cliente ya tiene servidor de WhatsApp. Usa «Cambiar servidor» para sustituirlo.", 409);
  }

  let baseUrl: string;
  let apiKeyEnc: string;
  let apiKey: string;
  if ("fromWorkspaceId" in input) {
    if (input.fromWorkspaceId === workspaceId) throw new WhatsappProvisionError("Elige otro cliente", 400);
    const source = await prisma.workspace.findUnique({ where: { id: input.fromWorkspaceId }, select: { settings: true } });
    const w = ((source?.settings as any)?.whatsapp ?? {}) as Record<string, unknown>;
    if (!source || typeof w.wahaUrl !== "string" || !w.wahaUrl || typeof w.wahaApiKeyEnc !== "string" || !w.wahaApiKeyEnc) {
      throw new WhatsappProvisionError("Ese cliente no tiene servidor de WhatsApp activado", 400);
    }
    baseUrl = allowedUrl(w.wahaUrl);
    apiKeyEnc = w.wahaApiKeyEnc;
    apiKey = decryptSecret(apiKeyEnc);
  } else {
    const url = String(input.url ?? "").trim();
    apiKey = String(input.apiKey ?? "").trim();
    if (!url || url.length > 300) throw new WhatsappProvisionError("Indica la dirección del servidor de WhatsApp", 400);
    if (!apiKey || apiKey.length > 300) throw new WhatsappProvisionError("Indica la API key del servidor de WhatsApp", 400);
    baseUrl = allowedUrl(url);
    apiKeyEnc = encryptSecret(apiKey);
  }

  await verifyServer(baseUrl, apiKey);
  const ownSession = derivedSessionName(workspaceId);
  const saved = await patchWorkspaceSettings(workspaceId, (settings) =>
    applyWhatsappServer(settings, { baseUrl, apiKeyEnc, ownSession, wasConfigured, webhookToken: randomToken() })
  );
  return whatsappServerStatus(saved);
}
