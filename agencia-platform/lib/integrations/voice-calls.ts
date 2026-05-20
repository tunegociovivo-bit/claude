/**
 * Llamadas de voz de Sonia vía Vapi (vapi.ai). El número y el asistente
 * "Sonia" (persona, voz, guion) se configuran en el panel de Vapi; aquí solo
 * disparamos llamadas y recogemos el resultado por webhook.
 *
 * Config en Workspace.settings.integrations.voice:
 *   { apiKeyEnc, phoneNumberId, assistantId }
 */
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

export class VoiceNotConfiguredError extends Error {
  constructor(msg = "Llamadas de voz no configuradas. Añade la API key de Vapi, el phoneNumberId y el assistantId en /admin/voz.") {
    super(msg);
  }
}

export type VoiceConfig = {
  apiKey: string | null;
  phoneNumberId: string | null;
  assistantId: string | null;
  webhookToken: string | null;
};

export async function getVoiceConfig(workspaceId: string): Promise<VoiceConfig> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const v = (ws?.settings as any)?.integrations?.voice ?? {};
  const apiKey = v.apiKeyEnc ? decryptSecret(v.apiKeyEnc) : process.env.VAPI_API_KEY ?? null;
  return {
    apiKey: apiKey || null,
    phoneNumberId: v.phoneNumberId ?? process.env.VAPI_PHONE_NUMBER_ID ?? null,
    assistantId: v.assistantId ?? process.env.VAPI_ASSISTANT_ID ?? null,
    webhookToken: v.webhookTokenEnc ? decryptSecret(v.webhookTokenEnc) : v.webhookToken ?? null
  };
}

/** Normaliza un teléfono a formato E.164 básico (+34… si parece español). */
export function normalizePhone(raw: string): string {
  let n = raw.replace(/[^\d+]/g, "");
  if (n.startsWith("+")) return n;
  if (n.length === 9) return `+34${n}`; // móvil/fijo español sin prefijo
  if (n.startsWith("34")) return `+${n}`;
  return n.startsWith("+") ? n : `+${n}`;
}

/**
 * Inicia una llamada saliente. `goal` se pasa como variable al asistente
 * de Vapi (usa {{goal}} en su prompt) para guiar la conversación.
 */
export async function startVoiceCall(opts: {
  workspaceId: string;
  toNumber: string;
  goal: string;
  variables?: Record<string, string>;
}): Promise<{ id: string; providerCallId: string | null }> {
  const cfg = await getVoiceConfig(opts.workspaceId);
  if (!cfg.apiKey || !cfg.phoneNumberId || !cfg.assistantId) throw new VoiceNotConfiguredError();
  const to = normalizePhone(opts.toNumber);

  const resp = await fetch("https://api.vapi.ai/call", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      phoneNumberId: cfg.phoneNumberId,
      assistantId: cfg.assistantId,
      customer: { number: to },
      assistantOverrides: {
        variableValues: { goal: opts.goal, ...(opts.variables ?? {}) }
      }
    })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Vapi ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  const providerCallId = data?.id ?? null;

  const call = await prisma.voiceCall.create({
    data: {
      workspaceId: opts.workspaceId,
      provider: "vapi",
      providerCallId,
      toNumber: to,
      goal: opts.goal,
      status: data?.status ?? "queued"
    }
  });
  return { id: call.id, providerCallId };
}

/**
 * Procesa el webhook de Vapi (end-of-call-report u otros status). Actualiza
 * la VoiceCall con transcripción, resumen y datos. Devuelve si se aplicó.
 */
export async function handleVapiWebhook(payload: any): Promise<{ ok: boolean }> {
  const msg = payload?.message ?? payload;
  const call = msg?.call ?? payload?.call;
  const providerCallId = call?.id ?? msg?.callId ?? null;
  if (!providerCallId) return { ok: false };
  const existing = await prisma.voiceCall.findFirst({ where: { providerCallId } });
  if (!existing) return { ok: false };

  const type = msg?.type;
  const data: any = {};
  if (type === "status-update" && msg?.status) data.status = msg.status;
  if (type === "end-of-call-report" || msg?.endedReason) {
    data.status = "ended";
    if (msg?.endedReason) data.endedReason = msg.endedReason;
    if (typeof msg?.transcript === "string") data.transcript = msg.transcript.slice(0, 20000);
    const summary = msg?.summary ?? msg?.analysis?.summary;
    if (typeof summary === "string") data.summary = summary.slice(0, 4000);
    const structured = msg?.analysis?.structuredData ?? msg?.artifact?.structuredData;
    if (structured) data.structured = structured;
    const rec = msg?.recordingUrl ?? msg?.artifact?.recordingUrl ?? call?.recordingUrl;
    if (rec) data.recordingUrl = rec;
    if (typeof call?.startedAt === "string" && typeof call?.endedAt === "string") {
      data.durationSec = Math.max(0, Math.round((Date.parse(call.endedAt) - Date.parse(call.startedAt)) / 1000));
    }
  }
  if (Object.keys(data).length === 0) return { ok: true };
  await prisma.voiceCall.update({ where: { id: existing.id }, data });
  return { ok: true };
}
