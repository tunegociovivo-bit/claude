import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/auth";
import { inboxError, requireInboxUser } from "@/lib/inbox/api";
import { describeDecision, enqueueOutbound, processIfDue } from "@/lib/inbox/outbound";
import { MAX_VOICE_UPLOAD_BYTES, toWhatsappVoiceNote, VoiceFormatError } from "@/lib/inbox/voice";
import { buildS3Key, uploadBuffer } from "@/lib/storage/r2";
import type { StoredMedia } from "@/lib/inbox/media-core";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

// POST (multipart: audio + idempotencyKey) → nota de voz grabada en el CRM.
// Sale como nota de voz de WhatsApp por el número del chat, por la misma cola
// anti-baneo que los textos.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isSameOrigin(req)) return Response.json({ error: "Origen no permitido" }, { status: 403 });
    const user = await requireInboxUser();
    // El tamaño se comprueba ANTES de leer el cuerpo (sin cabecera, no se acepta).
    const declared = Number(req.headers.get("content-length") ?? "");
    if (!Number.isFinite(declared) || declared <= 0) {
      return Response.json({ error: "Falta el tamaño de la grabación" }, { status: 411 });
    }
    if (declared > MAX_VOICE_UPLOAD_BYTES + 64 * 1024) {
      return Response.json({ error: "La grabación es demasiado larga (máx. 5 minutos)" }, { status: 413 });
    }
    const form = await req.formData().catch(() => null);
    const audio = form?.get("audio");
    const keyRaw = String(form?.get("idempotencyKey") ?? "");
    const idempotencyKey = /^[A-Za-z0-9_-]{8,80}$/.test(keyRaw) ? `voz:${keyRaw}` : null;
    if (!audio || typeof audio === "string") return Response.json({ error: "No ha llegado el audio" }, { status: 400 });
    if (audio.size === 0) return Response.json({ error: "La grabación está vacía" }, { status: 400 });
    if (audio.size > MAX_VOICE_UPLOAD_BYTES) return Response.json({ error: "La grabación es demasiado larga (máx. 5 minutos)" }, { status: 413 });

    const conversation = await prisma.conversation.findFirst({
      where: { id: params.id, workspaceId: user.workspaceId },
      select: { id: true, lineId: true },
    });
    if (!conversation) return Response.json({ error: "Conversación no encontrada" }, { status: 404 });

    // Reintento del mismo envío (red móvil): se devuelve lo que ya hay.
    if (idempotencyKey) {
      const existing = await prisma.outboundMessage.findUnique({ where: { idempotencyKey } });
      if (existing) {
        if (existing.workspaceId !== user.workspaceId || existing.conversationId !== conversation.id) {
          return Response.json({ error: "Clave de envío reutilizada" }, { status: 409 });
        }
        return Response.json({ outbound: { ...existing, media: undefined }, result: { status: existing.status, code: "OK", message: "" } }, { status: 201 });
      }
    }

    let converted: { data: Buffer; seconds: number | null };
    try {
      converted = await toWhatsappVoiceNote(Buffer.from(await audio.arrayBuffer()));
    } catch (error) {
      if (error instanceof VoiceFormatError) return Response.json({ error: error.message }, { status: 422 });
      console.error("[voice] no se pudo convertir:", (error as Error)?.message);
      return Response.json({ error: "No se pudo procesar la grabación. Vuelve a grabarla." }, { status: 422 });
    }
    const key = buildS3Key({
      workspaceId: user.workspaceId,
      targetType: "whatsapp",
      targetId: conversation.lineId ?? "crm",
      filename: "nota-de-voz.ogg",
    });
    await uploadBuffer({ s3Key: key, body: converted.data, contentType: "audio/ogg" });
    const media: StoredMedia = {
      kind: "voice",
      mimetype: "audio/ogg; codecs=opus",
      filename: "nota-de-voz.ogg",
      caption: "",
      size: converted.data.length,
      key,
      thumbKey: null,
      error: null,
    };
    const { outbound, decision } = await enqueueOutbound({
      workspaceId: user.workspaceId,
      conversationId: conversation.id,
      body: "🎤 Nota de voz",
      origin: "manual",
      userId: user.userId,
      idempotencyKey,
      media,
    });
    const final = await processIfDue(outbound, 12_000);
    return Response.json(
      { outbound: final ? { ...final, media: undefined } : final, result: describeDecision(decision), seconds: converted.seconds },
      { status: decision.kind === "block" ? 422 : 201 }
    );
  } catch (error) {
    return inboxError(error);
  }
}
