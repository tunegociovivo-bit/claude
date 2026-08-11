import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspaceId, unauthorized } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import {
  getWorkspaceSettings,
  saveWorkspaceSettings,
  publicBaseUrl,
} from "@/lib/settings";

// Configuración de SONIA por cliente: prompt, negocio, Vapi, WhatsApp.
export async function GET() {
  let workspaceId: string;
  try {
    workspaceId = await requireWorkspaceId();
  } catch {
    return unauthorized();
  }
  let settings = await getWorkspaceSettings(workspaceId);

  // Generar tokens de webhook la primera vez
  if (!settings.vapiWebhookToken || !settings.whatsappWebhookToken) {
    settings = await saveWorkspaceSettings(workspaceId, {
      vapiWebhookToken: settings.vapiWebhookToken || randomToken(),
      whatsappWebhookToken: settings.whatsappWebhookToken || randomToken(),
    });
  }

  const base = publicBaseUrl();

  // La fontanería de WAHA (URL, API key, sesión, estado) no se expone al
  // cliente: la conexión se gestiona con el flujo de QR (waha-connection) y
  // las credenciales viven cifradas en BD para uso exclusivo del servidor.
  return NextResponse.json({
    sonia: settings.sonia,
    whatsapp: {
      countryCode: settings.whatsapp.countryCode,
      autoReplyEnabled: settings.whatsapp.autoReplyEnabled,
    },
    urgentAlerts: settings.urgentAlerts,
    pipeline: settings.pipeline,
    webhooks: {
      vapi: `${base}/api/webhooks/vapi/${settings.vapiWebhookToken}`,
    },
  });
}

const putSchema = z.object({
  sonia: z
    .object({
      agentName: z.string().trim().min(1).max(50),
      websiteUrl: z.string().max(500),
      businessName: z.string().max(200),
      businessInfo: z.string().max(20000),
      openingHours: z.string().max(500),
      promptExtra: z.string().max(20000),
      slotMinutes: z.number().int().min(5).max(480),
      firstMessage: z.string().max(1000),
      vapiModelProvider: z.string().max(50),
      vapiModel: z.string().max(100),
      vapiVoiceProvider: z.string().max(50),
      vapiVoiceId: z.string().max(200),
    })
    .partial()
    .optional(),
  // URL, API key y sesión de WAHA NO se aceptan desde el cliente: se
  // aprovisionan server-side y se conservan tal cual en BD.
  whatsapp: z
    .object({
      countryCode: z.string().max(4),
      autoReplyEnabled: z.boolean(),
    })
    .partial()
    .optional(),
  urgentAlerts: z.object({
    enabled: z.boolean(),
    email: z.union([z.string().trim().email(), z.literal("")]).transform((value) => value.toLowerCase()),
    phone: z.string().max(30),
  }).partial().optional(),
});

export async function PUT(req: NextRequest) {
  let workspaceId: string;
  try {
    workspaceId = await requireWorkspaceId();
  } catch {
    return unauthorized();
  }
  const parsed = putSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const current = await getWorkspaceSettings(workspaceId);
  const { whatsapp, sonia, urgentAlerts } = parsed.data;

  // Solo campos funcionales: la fontanería de WAHA (URL/key/sesión) nunca se
  // toca desde aquí, así que lo guardado en BD se conserva intacto.
  await saveWorkspaceSettings(workspaceId, {
    sonia: { ...current.sonia, ...(sonia ?? {}) },
    whatsapp: { ...current.whatsapp, ...(whatsapp ?? {}) },
    urgentAlerts: { ...current.urgentAlerts, ...(urgentAlerts ?? {}) },
  });
  return NextResponse.json({ ok: true });
}
