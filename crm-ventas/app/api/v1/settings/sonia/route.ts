import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspaceId, unauthorized } from "@/lib/auth";
import { encryptSecret, maskSecret, decryptSecret, randomToken } from "@/lib/crypto";
import {
  getWorkspaceSettings,
  saveWorkspaceSettings,
  publicBaseUrl,
} from "@/lib/settings";
import { assertAllowedWahaUrl, getSessionStatus, WahaUrlNotAllowedError } from "@/lib/waha";

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
  const wahaStatus = settings.whatsapp.wahaUrl
    ? await getSessionStatus(workspaceId)
    : null;

  return NextResponse.json({
    sonia: settings.sonia,
    whatsapp: {
      ...settings.whatsapp,
      wahaApiKeyEnc: undefined,
      wahaApiKeyMasked: settings.whatsapp.wahaApiKeyEnc
        ? maskSecret(decryptSecret(settings.whatsapp.wahaApiKeyEnc))
        : "",
    },
    pipeline: settings.pipeline,
    webhooks: {
      vapi: `${base}/api/webhooks/vapi/${settings.vapiWebhookToken}`,
      whatsapp: `${base}/api/webhooks/whatsapp/${settings.whatsappWebhookToken}`,
    },
    wahaStatus,
  });
}

const putSchema = z.object({
  sonia: z
    .object({
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
  whatsapp: z
    .object({
      wahaUrl: z.string().max(500),
      wahaApiKey: z.string().max(500), // en claro; se cifra aquí
      wahaSession: z.string().max(100),
      countryCode: z.string().max(4),
      autoReplyEnabled: z.boolean(),
    })
    .partial()
    .optional(),
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
  const { whatsapp, sonia } = parsed.data;

  // Anti-SSRF: solo se aceptan URLs de WAHA dentro de la lista de orígenes
  // permitidos (WAHA_ALLOWED_ORIGINS). Vacío = desconfigurar, permitido.
  if (whatsapp?.wahaUrl) {
    try {
      assertAllowedWahaUrl(whatsapp.wahaUrl);
    } catch (err) {
      if (err instanceof WahaUrlNotAllowedError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }

  const whatsappPatch: any = { ...whatsapp };
  if (whatsapp && "wahaApiKey" in whatsapp) {
    whatsappPatch.wahaApiKeyEnc = whatsapp.wahaApiKey
      ? encryptSecret(whatsapp.wahaApiKey)
      : "";
    delete whatsappPatch.wahaApiKey;
  }

  await saveWorkspaceSettings(workspaceId, {
    sonia: { ...current.sonia, ...(sonia ?? {}) },
    whatsapp: { ...current.whatsapp, ...whatsappPatch },
  });
  return NextResponse.json({ ok: true });
}
