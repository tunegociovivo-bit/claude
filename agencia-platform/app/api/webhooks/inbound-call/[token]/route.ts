/**
 * POST /api/webhooks/inbound-call/[token]   — Fase 32
 *
 * Endpoint genérico para LLAMADAS TELEFÓNICAS ENTRANTES desde
 * cualquier provider que entregue transcript + metadatos via JSON:
 *   - Twilio (Voice + Transcription o Studio webhook)
 *   - Vonage (Voice + Speech-to-Text)
 *   - Aircall (post-call webhook)
 *   - Cualquier servicio que haga POST con shape compatible
 *
 * NV IA procesa la llamada: clasifica intención, busca cliente conocido,
 * redacta acción siguiente (email de seguimiento, callback agendado,
 * tarea para humano si requiere intervención).
 *
 * Auth: token por workspace en settings.aiAgent.inbound.call.webhookToken.
 *
 * Shape normalizado (acepta varios nombres por compatibilidad):
 *   {
 *     from: "+34600...",       // o "From", "caller"
 *     to: "+34900...",         // o "To", "called"
 *     transcript: "Hola...",   // o "Transcription", "transcript_text"
 *     durationSec: 124,        // o "duration", "CallDuration"
 *     recordingUrl: "https://...", // opcional
 *     callSid: "CAxxx"         // o "id", "CallSid", "external_id"
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { triggerNvIaFromInbound } from "@/lib/ai/nv-ia/inbound-trigger";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const token = String(params.token ?? "").trim();
  if (!token || token.length < 16) {
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 401 });
  }
  const wsAll = await prisma.workspace.findMany({ select: { id: true, settings: true } });
  const ws = wsAll.find((w) => (w.settings as any)?.aiAgent?.inbound?.call?.webhookToken === token);
  if (!ws) return NextResponse.json({ ok: false, error: "token not found" }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const from = String(body.from ?? body.From ?? body.caller ?? "").trim();
  const to = String(body.to ?? body.To ?? body.called ?? "").trim();
  const transcript = String(body.transcript ?? body.Transcription ?? body.transcript_text ?? "").trim();
  const durationSec = Number(body.durationSec ?? body.duration ?? body.CallDuration ?? 0) || 0;
  const recordingUrl = String(body.recordingUrl ?? body.RecordingUrl ?? body.recording_url ?? "").trim();
  const callId = String(body.callSid ?? body.id ?? body.CallSid ?? body.external_id ?? `call-${Date.now()}`).trim();

  if (!from || !transcript) {
    return NextResponse.json({ ok: false, error: "missing from/transcript" }, { status: 400 });
  }

  // Asociar a cliente por teléfono normalizado si lo conocemos.
  let clientId: string | null = null;
  try {
    const digits = from.replace(/\D/g, "");
    if (digits.length >= 9) {
      const c = await prisma.client.findFirst({
        where: {
          workspaceId: ws.id,
          phone: { contains: digits.slice(-9), mode: "insensitive" }
        },
        select: { id: true }
      });
      if (c) clientId = c.id;
    }
  } catch {}

  const r = await triggerNvIaFromInbound({
    workspaceId: ws.id,
    externalId: callId,
    trigger: "CALL_INBOUND",
    taskTitle: `📞 Llamada de ${from} (${Math.round(durationSec / 60)}min)`,
    body:
      `Transcripción de la llamada:\n\n${transcript.slice(0, 14000)}\n\n` +
      `---\nDuración: ${durationSec}s\n` +
      (recordingUrl ? `Audio: ${recordingUrl}\n` : ""),
    metadata: {
      from,
      to,
      durationSec: String(durationSec),
      callId,
      ...(recordingUrl ? { recordingUrl } : {})
    },
    clientId
  });

  if (!r) {
    return NextResponse.json({
      ok: true,
      processed: false,
      reason: "nv_ia_inbound_disabled_or_not_configured"
    });
  }
  return NextResponse.json({ ok: true, processed: true, taskId: r.taskId, runId: r.runId });
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  return NextResponse.json({
    ok: true,
    endpoint: "inbound-call",
    tokenValid: String(params.token ?? "").length >= 16,
    expectedShape: {
      from: "+34600...",
      to: "+34900...",
      transcript: "texto de la llamada",
      durationSec: 124,
      recordingUrl: "https://...",
      callSid: "CAxxx"
    }
  });
}
