import "server-only";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getWorkspaceSettings, publicBaseUrl, saveWorkspaceSettings } from "@/lib/settings";
import { configureInboundPhone, createManagedPhone, importTwilioPhone, VapiApiError } from "@/lib/vapi/client";
import type { ProvisionVapiPhoneInput } from "@/lib/vapi/schemas";

const BUILTIN_PROTECTED_IDS = new Set(["63901b3b-f92a-4f63-8461-5e48f21ff719"]);
const BUILTIN_PROTECTED_NUMBERS = new Set(["+34613068550"]);

function envSet(name: string) {
  return new Set((process.env[name] || "").split(",").map((v) => v.trim()).filter(Boolean));
}

function isProtected(id?: string | null, number?: string | null) {
  return Boolean(
    (id && (BUILTIN_PROTECTED_IDS.has(id) || envSet("VAPI_PROTECTED_PHONE_NUMBER_IDS").has(id))) ||
      (number && (BUILTIN_PROTECTED_NUMBERS.has(number) || envSet("VAPI_PROTECTED_E164").has(number)))
  );
}

export function vapiSelfServiceEnabled() {
  return process.env.VAPI_PHONE_SELF_SERVICE_ENABLED === "true";
}

async function webhookUrl(workspaceId: string) {
  const settings = await getWorkspaceSettings(workspaceId);
  let token = settings.vapiWebhookToken;
  if (!token) {
    token = randomBytes(24).toString("base64url");
    await saveWorkspaceSettings(workspaceId, { vapiWebhookToken: token });
  }
  return `${publicBaseUrl()}/api/webhooks/vapi/${token}`;
}

export async function getVapiPhoneConnection(workspaceId: string) {
  return prisma.vapiPhoneConnection.findUnique({
    where: { workspaceId },
    select: { mode: true, status: true, providerKind: true, e164: true, label: true, lastErrorMessage: true, createdAt: true, updatedAt: true },
  });
}

export async function provisionVapiPhone(workspaceId: string, input: ProvisionVapiPhoneInput, operationKey: string) {
  if (!vapiSelfServiceEnabled()) throw new VapiApiError("FEATURE_DISABLED", "La conexión automática todavía no está habilitada", 503);
  // Esta comprobación debe ocurrir antes de importar: Vapi puede modificar el
  // routing de Twilio como efecto de la propia llamada de creación.
  if (input.mode === "IMPORTED" && isProtected(null, input.phoneNumber)) {
    throw new VapiApiError("PROTECTED_PHONE", "Ese número está protegido y no puede modificarse", 403);
  }

  const existing = await prisma.vapiPhoneConnection.findUnique({ where: { workspaceId } });
  if (existing && existing.operationKey === operationKey) return existing;
  if (existing) {
    // Un fallo externo puede ser ambiguo (Vapi pudo crear el recurso aunque se
    // perdiera la respuesta). Bloqueamos nuevos intentos para evitar duplicados
    // y costes; Negocio Vivo debe reconciliarlo antes de liberar el workspace.
    const message = existing.status === "FAILED"
      ? "El intento anterior requiere revisión de Negocio Vivo antes de reintentarlo"
      : "Este negocio ya tiene un número asignado";
    throw new VapiApiError("PHONE_ALREADY_EXISTS", message, 409);
  }

  const row = await prisma.vapiPhoneConnection.create({
    data: { workspaceId, operationKey, mode: input.mode, providerKind: input.mode === "IMPORTED" ? input.providerKind : "vapi", label: input.label, status: "PROVISIONING" },
  });

  try {
    const url = await webhookUrl(workspaceId);
    let id = row.vapiPhoneNumberId;
    let number = row.e164;
    if (!id) {
      const phone = input.mode === "PURCHASED"
        ? await createManagedPhone(input.areaCode, input.label)
        : await importTwilioPhone({ number: input.phoneNumber, accountSid: input.twilioAccountSid, authToken: input.twilioAuthToken, name: input.label });
      id = phone.id;
      number = phone.number || (input.mode === "IMPORTED" ? input.phoneNumber : null);
      if (!id || isProtected(id, number)) throw new VapiApiError("PROTECTED_PHONE", "Ese número está protegido y no puede modificarse", 403);
      await prisma.vapiPhoneConnection.update({ where: { id: row.id }, data: { vapiPhoneNumberId: id, e164: number } });
    }
    if (isProtected(id, number)) throw new VapiApiError("PROTECTED_PHONE", "Ese número está protegido y no puede modificarse", 403);
    await configureInboundPhone(id, url);
    return prisma.vapiPhoneConnection.update({ where: { id: row.id }, data: { status: "ACTIVE", e164: number, label: input.label } });
  } catch (error) {
    const safe = error instanceof VapiApiError ? error : new VapiApiError("PROVISION_FAILED", "No se pudo configurar el número");
    await prisma.vapiPhoneConnection.update({ where: { id: row.id }, data: { status: "FAILED", lastErrorCode: safe.code, lastErrorMessage: safe.message } }).catch(() => undefined);
    throw safe;
  }
}
