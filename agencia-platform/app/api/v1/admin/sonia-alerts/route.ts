/**
 * GET    /api/v1/admin/sonia-alerts  → config actual del USER caller
 * PUT    /api/v1/admin/sonia-alerts  → guarda config + bot token workspace
 *
 * Config per-user almacenada en Workspace.settings.aiAgent.notificationChannels[userId]
 * Telegram bot token (workspace-wide) en Workspace.settings.integrations.telegram.botToken
 *
 * Estructura del payload PUT:
 * {
 *   telegramBotToken?: string,        // workspace-level, opcional
 *   telegram?: { enabled, chatId },
 *   whatsapp?: { enabled, phone },
 *   respectWorkingHours?: boolean,
 *   workingHours?: { start: number, end: number, timezone: string },
 *   minLevel?: "warning" | "critical"
 * }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "admin" }, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const settings = (ws?.settings as any) ?? {};
  const channels = settings?.aiAgent?.notificationChannels?.[api.userId] ?? {};
  const telegramBotToken = settings?.integrations?.telegram?.botToken ?? null;
  return NextResponse.json({
    hasBotToken: !!telegramBotToken,
    telegram: channels.telegram ?? { enabled: false, chatId: null },
    whatsapp: channels.whatsapp ?? { enabled: false, phone: null },
    respectWorkingHours: channels.respectWorkingHours ?? true,
    workingHours: channels.workingHours ?? {
      start: 9,
      end: 19,
      timezone: "Europe/Madrid"
    },
    minLevel: channels.minLevel ?? "warning"
  });
});

export const PUT = withApi({ scope: "admin" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const body = await req.json().catch(() => ({}));

  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const settings: any = ws?.settings ?? {};

  // Bot token (workspace-wide). Si llega vacío y NO hay actual, NO error
  // (Telegram es opcional). Si llega vacío y hay actual, mantenemos.
  if (typeof body?.telegramBotToken === "string") {
    const newToken = body.telegramBotToken.trim();
    if (newToken) {
      if (!settings.integrations) settings.integrations = {};
      if (!settings.integrations.telegram) settings.integrations.telegram = {};
      settings.integrations.telegram.botToken = newToken;
    }
  }

  if (!settings.aiAgent) settings.aiAgent = {};
  if (!settings.aiAgent.notificationChannels) {
    settings.aiAgent.notificationChannels = {};
  }
  const current =
    settings.aiAgent.notificationChannels[api.userId] ?? {};

  const merged: any = { ...current };
  if (body?.telegram) {
    merged.telegram = {
      enabled: !!body.telegram.enabled,
      chatId: body.telegram.chatId ? String(body.telegram.chatId).trim() : null
    };
  }
  if (body?.whatsapp) {
    merged.whatsapp = {
      enabled: !!body.whatsapp.enabled,
      phone: body.whatsapp.phone ? String(body.whatsapp.phone).trim() : null
    };
  }
  if (typeof body?.respectWorkingHours === "boolean") {
    merged.respectWorkingHours = body.respectWorkingHours;
  }
  if (body?.workingHours && typeof body.workingHours === "object") {
    merged.workingHours = {
      start: Math.max(0, Math.min(23, Number(body.workingHours.start) || 9)),
      end: Math.max(0, Math.min(24, Number(body.workingHours.end) || 19)),
      timezone:
        typeof body.workingHours.timezone === "string"
          ? body.workingHours.timezone
          : "Europe/Madrid"
    };
  }
  if (body?.minLevel === "warning" || body?.minLevel === "critical") {
    merged.minLevel = body.minLevel;
  }

  settings.aiAgent.notificationChannels[api.userId] = merged;

  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings }
  });
  return NextResponse.json({ ok: true });
});

// POST /api/v1/admin/sonia-alerts/test → manda un mensaje de prueba
// a los canales configurados del user. Útil para verificar setup
// sin tener que esperar a un evento real.
export const POST = withApi({ scope: "admin" }, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const { notifyHumanOutsideHub } = await import(
    "@/lib/notifications/multi-channel"
  );
  // Bypass del filtro de horario laboral para tests
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const settings: any = ws?.settings ?? {};
  const userCfg =
    settings?.aiAgent?.notificationChannels?.[api.userId] ?? {};
  // Forzamos respectWorkingHours=false en el test
  const settingsCopy = JSON.parse(JSON.stringify(settings));
  settingsCopy.aiAgent.notificationChannels[api.userId] = {
    ...userCfg,
    respectWorkingHours: false,
    minLevel: "info"
  };
  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings: settingsCopy }
  });
  const result = await notifyHumanOutsideHub({
    workspaceId: api.workspaceId,
    userId: api.userId,
    level: "info",
    title: "Test de canal — Sonia",
    body: "Si ves este mensaje, el canal funciona correctamente.",
    linkPath: "/admin/sonia-alerts"
  });
  // Restauramos config original
  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings }
  });
  return NextResponse.json({ ok: true, result });
});
