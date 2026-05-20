/**
 * POST /api/v1/voice/webhook  (PÚBLICO)
 * Webhook de Vapi: recibe status-update y end-of-call-report y actualiza la
 * VoiceCall (transcripción, resumen, datos). Se valida por el providerCallId
 * (debe existir una VoiceCall nuestra con ese id).
 */
import { NextRequest, NextResponse } from "next/server";
import { rateLimitPublic } from "@/lib/api/handler";
import { handleVapiWebhook } from "@/lib/integrations/voice-calls";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = rateLimitPublic(req, { tag: "voice-webhook", limit: 300 });
  if (limited) return limited;
  const payload = await req.json().catch(() => null);
  if (!payload) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    const r = await handleVapiWebhook(payload);
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 200 });
  }
}
