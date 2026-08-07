import "server-only";
import { randomBytes, randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getWorkspaceSettings, publicBaseUrl, saveWorkspaceSettings } from "@/lib/settings";
import { configureInboundPhone, createManagedPhone, getVapiPhone, importTwilioPhone, VapiApiError } from "@/lib/vapi/client";
import type { BusinessPhoneInput, OperatorRegisterPhoneInput, ProvisionVapiPhoneInput } from "@/lib/vapi/schemas";
import { opsEmailRecipient, sendOpsEmail } from "@/lib/notify-email";

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

// Un intento FAILED solo es liberable si no consta ningún recurso externo:
// ni id de número en Vapi ni e164. Si hay cualquiera de los dos, Vapi pudo
// crear (o tocar) algo real y hace falta reconciliación manual.
function isReleasable(row: { status: string; vapiPhoneNumberId: string | null; e164: string | null }) {
  return row.status === "FAILED" && !row.vapiPhoneNumberId && !row.e164;
}

export async function getVapiPhoneConnection(workspaceId: string) {
  const row = await prisma.vapiPhoneConnection.findUnique({ where: { workspaceId } });
  if (!row) return null;
  return {
    mode: row.mode,
    status: row.status,
    providerKind: row.providerKind,
    e164: row.e164,
    publicE164: row.publicE164,
    // Al cliente nunca se le muestran ids de Vapi ni el detalle del puente;
    // solo el hecho de que la infraestructura existe (para su checklist).
    infrastructureReady: Boolean(row.vapiPhoneNumberId),
    label: row.label,
    lastErrorMessage: row.lastErrorMessage,
    notifyPending: Boolean(row.publicE164 && row.publicE164 !== row.notifiedE164),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    releasable: isReleasable(row),
  };
}

// ---------- Flujo comercial: el cliente solo indica su móvil público ----------

// Aviso operativo a Negocio Vivo. Deduplicado por notifiedE164: solo se envía
// cuando el móvil guardado difiere del último notificado con éxito, y un fallo
// deja el aviso pendiente (se reintenta en el siguiente guardado). Nunca lanza:
// el cambio del cliente jamás se pierde por un problema de email.
async function notifyOperatorOfPhoneRequest(rowId: string, workspaceId: string, requestedBy?: string | null) {
  const row = await prisma.vapiPhoneConnection.findUnique({ where: { id: rowId } });
  if (!row?.publicE164 || row.publicE164 === row.notifiedE164) return;
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });
  const when = new Date();
  const result = await sendOpsEmail({
    subject: `CRM Ventas: activar teléfono de «${workspace?.name || workspaceId}»`,
    rows: [
      ["Negocio", workspace?.name || "(sin nombre)"],
      ["Teléfono del negocio", row.publicE164],
      ["Workspace", workspaceId],
      ["Solicitado por", requestedBy || "(no disponible)"],
      ["Fecha/hora", when.toISOString()],
      ["Siguiente paso", "Crear número puente Twilio Voice, conectarlo a Vapi y registrar el ID en el CRM (Ajustes → Operador)"],
    ],
    actionUrl: `${publicBaseUrl()}/ajustes`,
    actionLabel: "Abrir Ajustes del CRM",
  });
  await prisma.vapiPhoneConnection
    .update({
      where: { id: rowId },
      data: result.ok
        ? { notifiedE164: row.publicE164, notifiedAt: when, notifyError: null }
        : { notifyError: result.error },
    })
    .catch(() => undefined);
  if (!result.ok) {
    // Registro seguro: código de error y destinatario, nunca claves ni cuerpos.
    console.error(`[business-phone] aviso a ${opsEmailRecipient()} pendiente (${result.error}) para workspace ${workspaceId}`);
  }
}

// Guarda (o corrige) el móvil público del negocio. Sin credenciales de ningún
// proveedor: la infraestructura la crea Negocio Vivo aparte.
export async function saveBusinessPhone(workspaceId: string, input: BusinessPhoneInput, requestedBy?: string | null) {
  if (isProtected(null, input.phoneNumber)) {
    throw new VapiApiError("PROTECTED_PHONE", "Ese número está protegido y no puede usarse aquí", 403);
  }
  const existing = await prisma.vapiPhoneConnection.findUnique({ where: { workspaceId } });
  if (existing && existing.status === "PROVISIONING") {
    throw new VapiApiError("PHONE_BUSY", "Hay una operación en curso; espera a que termine", 409);
  }
  if (existing && existing.status === "FAILED" && !isReleasable(existing)) {
    throw new VapiApiError(
      "PHONE_NEEDS_RECONCILIATION",
      "El intento anterior requiere revisión de Negocio Vivo antes de continuar",
      409
    );
  }
  let row;
  if (!existing) {
    row = await prisma.vapiPhoneConnection.create({
      data: { workspaceId, operationKey: randomUUID(), mode: "MANAGED", status: "REQUESTED", publicE164: input.phoneNumber, label: input.label },
    });
  } else {
    // Cambiar el móvil de una conexión ya activa vuelve a "pendiente": el
    // desvío del móvil nuevo tiene que configurarse y probarse otra vez.
    // Un FAILED liberable se corrige aquí directamente (no dejó recursos).
    const changed = existing.publicE164 !== input.phoneNumber;
    row = await prisma.vapiPhoneConnection.update({
      where: { id: existing.id },
      data: {
        mode: existing.vapiPhoneNumberId ? existing.mode : "MANAGED",
        publicE164: input.phoneNumber,
        label: input.label ?? existing.label,
        status: existing.status === "ACTIVE" && !changed ? "ACTIVE" : "REQUESTED",
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
  }
  await notifyOperatorOfPhoneRequest(row.id, workspaceId, requestedBy);
  return getVapiPhoneConnection(workspaceId);
}

// ---------- Flujo interno de Negocio Vivo (operador) ----------

// Registra una infraestructura YA creada a mano (puente Twilio + número en
// Vapi) y la asigna a un workspace. Valida contra Vapi que el recurso existe y
// coincide con el puente declarado; nunca toca el número protegido de SONIA.
export async function operatorRegisterPhoneInfra(input: OperatorRegisterPhoneInput) {
  if (isProtected(input.vapiPhoneNumberId, input.bridgeE164) || (input.publicE164 && isProtected(null, input.publicE164))) {
    throw new VapiApiError("PROTECTED_PHONE", "Ese recurso está protegido y no puede asignarse", 403);
  }
  const workspace = await prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { id: true } });
  if (!workspace) throw new VapiApiError("WORKSPACE_NOT_FOUND", "Ese workspace no existe", 404);
  const other = await prisma.vapiPhoneConnection.findFirst({
    where: { vapiPhoneNumberId: input.vapiPhoneNumberId, NOT: { workspaceId: input.workspaceId } },
    select: { workspaceId: true },
  });
  if (other) {
    throw new VapiApiError("PHONE_TAKEN", "Ese número de Vapi ya está asignado a otro negocio", 409);
  }
  let phone;
  try {
    phone = await getVapiPhone(input.vapiPhoneNumberId);
  } catch (error) {
    if (error instanceof VapiApiError && error.code === "VAPI_404") {
      throw new VapiApiError("VAPI_PHONE_NOT_FOUND", "Ese id no existe en la cuenta de Vapi", 404);
    }
    throw error;
  }
  // Doble comprobación con la respuesta real de Vapi (id/número devueltos).
  if (isProtected(phone.id, phone.number)) {
    throw new VapiApiError("PROTECTED_PHONE", "Ese recurso está protegido y no puede asignarse", 403);
  }
  if (phone.number && phone.number !== input.bridgeE164) {
    throw new VapiApiError("PHONE_MISMATCH", `El número del recurso en Vapi (${phone.number}) no coincide con el puente indicado`, 409);
  }
  if (!phone.number) {
    throw new VapiApiError("PHONE_MISMATCH", "El recurso de Vapi no tiene número; revisa el id", 409);
  }
  if (input.configureInbound) {
    await configureInboundPhone(input.vapiPhoneNumberId, await webhookUrl(input.workspaceId));
  }
  const existing = await prisma.vapiPhoneConnection.findUnique({ where: { workspaceId: input.workspaceId } });
  const status = input.activate ? "ACTIVE" : existing?.status === "ACTIVE" ? "ACTIVE" : "REQUESTED";
  const data = {
    mode: "MANAGED",
    providerKind: "twilio",
    status,
    vapiPhoneNumberId: input.vapiPhoneNumberId,
    e164: input.bridgeE164,
    bridgeE164: input.bridgeE164,
    publicE164: input.publicE164 ?? existing?.publicE164 ?? null,
    label: input.label ?? existing?.label ?? null,
    lastErrorCode: null,
    lastErrorMessage: null,
  };
  if (existing) {
    await prisma.vapiPhoneConnection.update({ where: { id: existing.id }, data });
  } else {
    await prisma.vapiPhoneConnection.create({ data: { workspaceId: input.workspaceId, operationKey: randomUUID(), ...data } });
  }
  return getVapiPhoneConnection(input.workspaceId);
}

// Vista de operador: todos los negocios con el estado de su teléfono, para
// atender solicitudes pendientes. Incluye el detalle técnico que al cliente
// no se le muestra (id de Vapi, puente, aviso pendiente).
export async function listPhoneConnectionsForOperator() {
  const workspaces = await prisma.workspace.findMany({
    select: { id: true, name: true, vapiPhoneConnection: true },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return workspaces.map((workspace) => {
    const row = workspace.vapiPhoneConnection;
    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      status: row?.status ?? null,
      mode: row?.mode ?? null,
      publicE164: row?.publicE164 ?? null,
      bridgeE164: row?.bridgeE164 ?? null,
      vapiPhoneNumberId: row?.vapiPhoneNumberId ?? null,
      label: row?.label ?? null,
      lastErrorMessage: row?.lastErrorMessage ?? null,
      notifyPending: Boolean(row?.publicE164 && row.publicE164 !== row.notifiedE164),
      notifyError: row?.notifyError ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export async function releaseFailedVapiPhoneAttempt(workspaceId: string) {
  const row = await prisma.vapiPhoneConnection.findUnique({ where: { workspaceId } });
  if (!row) throw new VapiApiError("PHONE_NOT_FOUND", "No hay ningún intento que liberar", 404);
  if (row.status !== "FAILED") {
    throw new VapiApiError("PHONE_NOT_RELEASABLE", "Solo puede liberarse un intento fallido", 409);
  }
  if (!isReleasable(row)) {
    // No se borra nada en Vapi desde aquí: si quedó un recurso externo, debe
    // reconciliarlo Negocio Vivo a mano antes de liberar el workspace.
    throw new VapiApiError(
      "PHONE_NEEDS_RECONCILIATION",
      "El intento dejó recursos creados en Vapi y requiere reconciliación manual de Negocio Vivo",
      409
    );
  }
  await prisma.vapiPhoneConnection.delete({ where: { id: row.id } });
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
      ? (isReleasable(existing)
        ? "El intento anterior falló; usa «Corregir datos y volver a intentar» para liberarlo antes de reintentar"
        : "El intento anterior requiere revisión de Negocio Vivo antes de reintentarlo")
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
