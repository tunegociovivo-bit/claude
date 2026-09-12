import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { userCanAccessPlatform } from "@/lib/platforms-server";
import {
  normalizedPhone,
  PRINCIPAL_PHONE_KEY,
  sharedPhonesFromLeads
} from "@/lib/mobile/shared-phones";

const phoneSchema = z.string().trim().max(30).regex(/^\+?[0-9 ()-]*$/, "Número de teléfono no válido");
const requiredPhoneSchema = phoneSchema.refine((phone) => {
  const digits = normalizedPhone(phone);
  return digits.length >= 6 && digits.length <= 18;
}, "Introduce un número de teléfono válido");
const editablePhoneSchema = z.union([z.literal(""), requiredPhoneSchema]);
const serialSchema = z.string().trim().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]+$/, "Serie USB no válida");
const sessionSchema = z.string().trim().min(1).max(60).regex(/^[a-zA-Z0-9_-]+$/, "La sesión solo admite letras, números, guion y guion bajo");

const createSchema = z.object({
  sessionName: sessionSchema,
  label: z.string().trim().max(60).optional().default(""),
  phone: requiredPhoneSchema,
  deviceSerial: serialSchema.nullable().optional()
});

const updateSchema = z.object({
  key: z.string().trim().min(1).max(60),
  label: z.string().trim().max(60).optional(),
  phone: editablePhoneSchema.optional(),
  deviceSerial: serialSchema.nullable().optional(),
  active: z.boolean().optional()
});

async function loadContext(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  if (!(await userCanAccessPlatform(workspaceId, userId, "mobile_farm"))) {
    throw new ApiError(403, "forbidden", "No tienes acceso a F - Móviles");
  }
  const [workspace, membership] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } }),
    prisma.membership.findFirst({ where: { workspaceId, userId }, select: { role: true } })
  ]);
  if (!workspace || !membership) throw new ApiError(403, "forbidden", "No perteneces a este workspace");
  return { workspace, canManage: membership.role === "ADMIN" };
}

function requireManager(canManage: boolean) {
  if (!canManage) throw new ApiError(403, "forbidden", "Solo los administradores pueden modificar los teléfonos compartidos");
}

function cloneSettings(raw: unknown): any {
  return structuredClone((raw && typeof raw === "object" ? raw : {}) as object);
}

function assertUniquePhone(leads: any, phone: string, excludedKey?: string) {
  const normalized = normalizedPhone(phone);
  if (!normalized) return;
  const duplicatesPrincipal = excludedKey !== PRINCIPAL_PHONE_KEY
    && normalizedPhone(leads.principalPhone) === normalized;
  const duplicateChannel = leads.channels.some((channel: any) =>
    channel?.name !== excludedKey && normalizedPhone(channel?.phone) === normalized
  );
  if (duplicatesPrincipal || duplicateChannel) {
    throw new ApiError(409, "duplicate_phone", "Ese número ya existe en el inventario compartido");
  }
}

function moveSerialToTarget(leads: any, targetKey: string, serial: string | null | undefined) {
  if (serial === undefined) return;
  if (serial) {
    if (leads.principalDeviceSerial === serial && targetKey !== PRINCIPAL_PHONE_KEY) {
      leads.principalDeviceSerial = null;
    }
    leads.channels = leads.channels.map((channel: any) =>
      channel.deviceSerial === serial && channel.name !== targetKey
        ? { ...channel, deviceSerial: null }
        : channel
    );
  }
}

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const { workspace, canManage } = await loadContext(api.workspaceId, api.userId);
  const leads = (workspace.settings as any)?.leads ?? {};
  return NextResponse.json({ canManage, items: sharedPhonesFromLeads(leads) });
});

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const { workspace, canManage } = await loadContext(api.workspaceId, api.userId);
  requireManager(canManage);
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.issues[0]?.message ?? "Datos no válidos");

  const settings = cloneSettings(workspace.settings);
  settings.leads = settings.leads ?? {};
  const leads = settings.leads;
  leads.channels = Array.isArray(leads.channels) ? leads.channels.map((channel: any) => ({ ...channel })) : [];
  if (leads.channels.length >= 20) {
    throw new ApiError(409, "phone_limit", "El inventario compartido admite un máximo de 20 números adicionales");
  }
  if (
    parsed.data.sessionName === PRINCIPAL_PHONE_KEY
    || parsed.data.sessionName === String(leads.wahaSession ?? "default")
    || leads.channels.some((channel: any) => channel?.name === parsed.data.sessionName)
  ) {
    throw new ApiError(409, "duplicate_session", "Ya existe un teléfono con ese nombre de sesión");
  }
  assertUniquePhone(leads, parsed.data.phone);
  moveSerialToTarget(leads, parsed.data.sessionName, parsed.data.deviceSerial);
  leads.channels.push({
    name: parsed.data.sessionName,
    label: parsed.data.label || parsed.data.sessionName,
    phone: parsed.data.phone,
    deviceSerial: parsed.data.deviceSerial ?? null,
    dailyLimit: 50,
    active: true,
    addedAt: new Date().toISOString()
  });

  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true, items: sharedPhonesFromLeads(leads) }, { status: 201 });
});

export const PATCH = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const { workspace, canManage } = await loadContext(api.workspaceId, api.userId);
  requireManager(canManage);
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.issues[0]?.message ?? "Datos no válidos");

  const settings = cloneSettings(workspace.settings);
  settings.leads = settings.leads ?? {};
  const leads = settings.leads;
  leads.channels = Array.isArray(leads.channels) ? leads.channels.map((channel: any) => ({ ...channel })) : [];
  moveSerialToTarget(leads, parsed.data.key, parsed.data.deviceSerial);

  if (parsed.data.key === PRINCIPAL_PHONE_KEY) {
    if (parsed.data.phone !== undefined) {
      assertUniquePhone(leads, parsed.data.phone, PRINCIPAL_PHONE_KEY);
      leads.principalPhone = parsed.data.phone;
    }
    if (parsed.data.deviceSerial !== undefined) leads.principalDeviceSerial = parsed.data.deviceSerial;
  } else {
    const index = leads.channels.findIndex((channel: any) => channel?.name === parsed.data.key);
    if (index < 0) throw new ApiError(404, "phone_not_found", "El teléfono compartido ya no existe");
    if (parsed.data.phone !== undefined) {
      assertUniquePhone(leads, parsed.data.phone, parsed.data.key);
    }
    leads.channels[index] = {
      ...leads.channels[index],
      ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
      ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
      ...(parsed.data.deviceSerial !== undefined ? { deviceSerial: parsed.data.deviceSerial } : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {})
    };
  }

  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true, items: sharedPhonesFromLeads(leads) });
});
