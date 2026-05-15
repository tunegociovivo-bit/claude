/**
 * GET /api/public/credentials/[token]
 *
 * Endpoint público (sin sesión, validado SOLO por el token de un grant)
 * que devuelve las credenciales descifradas del workspace al que
 * pertenece el grant.
 *
 * Reglas:
 *   - Si no existe el grant, o está revocado, o expirado, o ya usado →
 *     410 Gone.
 *   - Marca el grant como usado en la primera lectura (single-use).
 *   - Loguea la IP que lo consumió.
 *
 * El token es de 96 chars hex (48 bytes), criptográficamente fuerte.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

export const dynamic = "force-dynamic";

function safeDecrypt(v: any): string | null {
  if (!v || typeof v !== "string") return null;
  try {
    return decryptSecret(v);
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  if (!params.token || params.token.length < 32) {
    return NextResponse.json({ error: { code: "bad_token", message: "Token inválido" } }, { status: 400 });
  }

  const grant = await prisma.credentialAccessGrant.findUnique({
    where: { token: params.token }
  });
  if (!grant) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Token desconocido" } },
      { status: 410 }
    );
  }
  if (grant.revokedAt) {
    return NextResponse.json(
      { error: { code: "revoked", message: "Token revocado por el admin" } },
      { status: 410 }
    );
  }
  if (grant.usedAt) {
    return NextResponse.json(
      { error: { code: "already_used", message: "Este token ya fue consumido. Pide otro al admin." } },
      { status: 410 }
    );
  }
  if (grant.expiresAt < new Date()) {
    return NextResponse.json(
      { error: { code: "expired", message: "Token caducado" } },
      { status: 410 }
    );
  }

  // Marca como usado ANTES de devolver para evitar carreras
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;
  await prisma.credentialAccessGrant.update({
    where: { id: grant.id },
    data: { usedAt: new Date(), usedFromIp: ip }
  });

  // Cargar workspace + descifrar
  const ws = await prisma.workspace.findUnique({ where: { id: grant.workspaceId } });
  const settings: any = ws?.settings ?? {};
  const ai = settings.ai ?? {};
  const editorial = settings.editorial ?? {};
  const leads = settings.leads ?? {};
  const integrations = settings.integrations ?? {};

  const credentials = {
    anthropicApiKey: safeDecrypt(ai.anthropicApiKey),
    openaiApiKey: safeDecrypt(ai.openaiApiKey),
    freepikApiKey: safeDecrypt(editorial.freepikApiKey),
    googlePlacesApiKey: safeDecrypt(leads.googleApiKey),
    wahaUrl: leads.wahaUrl ?? null,
    wahaApiKey: safeDecrypt(leads.wahaApiKey),
    wahaSession: leads.wahaSession ?? null,
    whatsappCountryCode: leads.whatsappCountryCode ?? null,
    leadsWebhookToken: leads.webhookToken ?? null,
    editorialMakeWebhookUrl: editorial.makeWebhookUrl ?? null,
    evolutionWebhookToken: integrations?.evolution?.webhookToken ?? null,
    wordpress: {
      url: integrations?.wordpress?.url ?? null,
      user: integrations?.wordpress?.user ?? null,
      appPassword: safeDecrypt(integrations?.wordpress?.appPasswordEncrypted)
    },
    // Storage R2 (vienen de env vars; el magic link los descifra para
    // que el equipo de soporte pueda verlos sin acceder a Railway).
    storage: {
      endpoint: process.env.STORAGE_ENDPOINT ?? null,
      region: process.env.STORAGE_REGION ?? null,
      bucket: process.env.STORAGE_BUCKET ?? null,
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? null,
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? null,
      publicUrl: process.env.STORAGE_PUBLIC_URL ?? null
    }
  };

  // Env vars informativas (booleano para presencia, valor solo para los no sensibles)
  const env = {
    INTERNAL_CRON_TOKEN: !!process.env.INTERNAL_CRON_TOKEN,
    GITHUB_TOKEN_FOR_ERRORS: !!process.env.GITHUB_TOKEN_FOR_ERRORS,
    GITHUB_REPO_FOR_ERRORS: process.env.GITHUB_REPO_FOR_ERRORS ?? null,
    CLAUDE_CODE_SESSION_URL: process.env.CLAUDE_CODE_SESSION_URL ?? null,
    STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT ?? null,
    STORAGE_BUCKET: process.env.STORAGE_BUCKET ?? null,
    STORAGE_PUBLIC_URL: process.env.STORAGE_PUBLIC_URL ?? null,
    STORAGE_ACCESS_KEY_ID: !!process.env.STORAGE_ACCESS_KEY_ID,
    STORAGE_SECRET_ACCESS_KEY: !!process.env.STORAGE_SECRET_ACCESS_KEY,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? null
  };

  return NextResponse.json({
    workspace: ws?.name ?? null,
    consumedAt: new Date().toISOString(),
    note: "Single-use: este token ya no es válido. Pídele otro al admin si lo necesitas de nuevo.",
    credentials,
    env
  });
}
