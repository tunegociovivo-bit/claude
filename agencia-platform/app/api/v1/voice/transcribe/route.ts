/**
 * Endpoint público: recibe audio multipart con campo "audio" + form field "slug".
 * Lo manda a Whisper (vía la API key del workspace dueño del slug) y devuelve
 * la transcripción.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { transcribeAudioWithWhisper } from "@/lib/ai/openai";
import { AIDisabledError } from "@/lib/ai/anthropic";

const MAX_BYTES = 25 * 1024 * 1024; // tope de Whisper
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 6;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_LIMIT) return true;
  arr.push(now);
  hits.set(ip, arr);
  return false;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "anon";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Demasiadas grabaciones. Espera un minuto." } },
      { status: 429 }
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "Falta multipart form-data" } },
      { status: 400 }
    );
  }
  const slug = form.get("slug");
  const audio = form.get("audio");
  if (typeof slug !== "string" || !slug) {
    return NextResponse.json(
      { error: { code: "missing_slug", message: "Falta el slug del negocio" } },
      { status: 400 }
    );
  }
  if (!(audio instanceof Blob)) {
    return NextResponse.json(
      { error: { code: "no_audio", message: "Falta el campo audio" } },
      { status: 400 }
    );
  }
  if (audio.size === 0) {
    return NextResponse.json(
      { error: { code: "empty_audio", message: "El audio está vacío" } },
      { status: 400 }
    );
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json(
      { error: { code: "audio_too_large", message: "El audio supera 25 MB" } },
      { status: 413 }
    );
  }

  const business = await prisma.voiceBusiness.findFirst({
    where: { slug },
    select: { workspaceId: true }
  });
  if (!business) {
    return NextResponse.json({ error: { code: "not_found", message: "Negocio no encontrado" } }, { status: 404 });
  }

  try {
    const filename =
      audio instanceof File && audio.name ? audio.name : "recording.webm";
    const transcript = await transcribeAudioWithWhisper({
      workspaceId: business.workspaceId,
      audio,
      filename,
      language: "es"
    });
    if (!transcript) {
      return NextResponse.json(
        { error: { code: "empty_transcript", message: "No se ha detectado nada en la grabación. Habla más cerca del micrófono." } },
        { status: 422 }
      );
    }
    return NextResponse.json({ transcript });
  } catch (e: any) {
    if (e instanceof AIDisabledError) {
      return NextResponse.json({ error: { code: "ai_disabled", message: e.message } }, { status: 503 });
    }
    return NextResponse.json(
      { error: { code: "whisper_error", message: String(e.message ?? e).slice(0, 200) } },
      { status: 502 }
    );
  }
}
