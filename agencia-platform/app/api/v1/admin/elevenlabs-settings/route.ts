/**
 * GET /api/v1/admin/elevenlabs-settings  → { hasKey, voiceId, modelId }
 * PUT /api/v1/admin/elevenlabs-settings  → guarda apiKey (cifrada) + voiceId + modelId
 * DELETE /api/v1/admin/elevenlabs-settings → borra la config (vuelve a "no configurado")
 *
 * El PUT valida contra ElevenLabs antes de guardar: llama a
 * /v1/voices/{voiceId} con la key — si responde 200 está OK; si
 * 401/404 devolvemos error claro para que el admin sepa qué tocar.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { encryptSecret } from "@/lib/ai/crypto";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "admin" }, async (_req, { api }) => {
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const cfg = (ws?.settings as any)?.integrations?.elevenlabs ?? {};
  return NextResponse.json({
    hasKey: !!cfg.apiKey,
    voiceId: cfg.voiceId ?? null,
    modelId: cfg.modelId ?? null,
    languageCode: cfg.languageCode ?? null
  });
});

export const PUT = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  const voiceId = typeof body?.voiceId === "string" ? body.voiceId.trim() : "";
  const modelId =
    typeof body?.modelId === "string" && body.modelId.trim()
      ? body.modelId.trim()
      : "eleven_turbo_v2_5";
  const languageCode =
    typeof body?.languageCode === "string" && body.languageCode.trim()
      ? body.languageCode.trim()
      : "es";
  if (!voiceId) return NextResponse.json({ error: "voiceId vacío" }, { status: 400 });

  // apiKey opcional en update — si llega vacío, mantenemos la existente.
  const ws0 = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const existingCfg = (ws0?.settings as any)?.integrations?.elevenlabs;
  const existingEncrypted = existingCfg?.apiKey as string | undefined;
  if (!apiKey && !existingEncrypted) {
    return NextResponse.json({ error: "apiKey requerido la primera vez" }, { status: 400 });
  }
  const effectiveEncryptedKey = apiKey ? encryptSecret(apiKey) : existingEncrypted!;

  // Validar voiceId contra ElevenLabs antes de persistir
  // (usa la apiKey en plano si llegó, o desciframos la actual).
  let plainKey = apiKey;
  if (!plainKey && existingEncrypted) {
    const { decryptSecret } = await import("@/lib/ai/crypto");
    plainKey = decryptSecret(existingEncrypted) ?? "";
  }
  const validateResp = await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
    headers: { "xi-api-key": plainKey }
  });
  if (!validateResp.ok) {
    const t = await validateResp.text();
    return NextResponse.json(
      {
        error:
          validateResp.status === 401
            ? "API key inválida (ElevenLabs respondió 401)."
            : validateResp.status === 404
              ? `Voice ID '${voiceId}' no existe en tu cuenta de ElevenLabs.`
              : `ElevenLabs ${validateResp.status}: ${t.slice(0, 200)}`
      },
      { status: 400 }
    );
  }
  const voiceInfo: any = await validateResp.json().catch(() => ({}));

  const settings: any = ws0?.settings ?? {};
  if (!settings.integrations) settings.integrations = {};
  settings.integrations.elevenlabs = {
    apiKey: effectiveEncryptedKey,
    voiceId,
    modelId,
    languageCode
  };
  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings }
  });
  return NextResponse.json({
    ok: true,
    voiceName: voiceInfo.name ?? null,
    voiceId,
    modelId,
    languageCode
  });
});

export const DELETE = withApi({ scope: "admin" }, async (_req, { api }) => {
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const settings: any = ws?.settings ?? {};
  if (settings?.integrations?.elevenlabs) {
    delete settings.integrations.elevenlabs;
    await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  }
  return NextResponse.json({ ok: true });
});
