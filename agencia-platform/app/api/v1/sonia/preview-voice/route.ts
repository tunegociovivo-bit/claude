/**
 * POST /api/v1/sonia/preview-voice
 *
 * Recibe { text, voiceId?, modelId? } y devuelve MP3 con la voz
 * configurada del workspace (o el override puntual de voiceId).
 *
 * Usado por /admin/sonia-voice-test para que el admin pruebe el
 * tono/velocidad sin esperar a que termine una task. Cap 600 chars
 * (3-4 frases) — no queremos que se use para generar audios largos
 * gratis, eso ya está cubierto por la tool generate_voice_audio que
 * adjunta al task.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { elevenlabsSynthesize } from "@/lib/integrations/elevenlabs";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "admin", admin: true }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const text = String(body?.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "text vacío" }, { status: 400 });
  }
  if (text.length > 600) {
    return NextResponse.json(
      { error: "text demasiado largo (max 600 chars)" },
      { status: 400 }
    );
  }
  try {
    const buf = await elevenlabsSynthesize({
      workspaceId: api.workspaceId,
      text,
      voiceId: typeof body?.voiceId === "string" && body.voiceId ? body.voiceId : undefined,
      modelId: typeof body?.modelId === "string" && body.modelId ? body.modelId : undefined
    });
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store"
      }
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
});
