/**
 * Endpoint público: toma una transcripción + slug del negocio y genera
 * el borrador de reseña con Claude (default) u OpenAI (según config).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { complete, AIDisabledError } from "@/lib/ai/anthropic";
import { openaiChatCompletion } from "@/lib/ai/openai";

const inputSchema = z.object({
  slug: z.string().min(1),
  transcript: z.string().min(5).max(4000)
});

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

function defaultSystemPrompt(name: string, location: string | null) {
  const loc = location ? ` (${location})` : "";
  return `Eres un asistente que ayuda a un cliente real de ${name}${loc} a estructurar su reseña a partir de lo que ha contado de viva voz.

REGLAS ESTRICTAS:
- Usa ÚNICAMENTE la información que el cliente menciona en su grabación. No inventes nombres de personal, habitaciones, platos, fechas, precios ni servicios.
- Si el cliente menciona poco, escribe una reseña corta (40-80 palabras). Si menciona mucho, máximo 150 palabras.
- Mantén su tono natural. Si habla coloquial, no lo pulas en exceso. Si habla en gallego, asturiano o cualquier otra lengua, responde en la misma lengua.
- Escribe en primera persona, como si fuese el propio cliente.
- Si menciona algo negativo, regular o una pega, INCLÚYELO tal cual. No edulcores ni elimines críticas.
- Evita clichés de marketing: "altamente recomendado", "experiencia 10/10", "todo perfecto", "sin lugar a dudas". Suenan falsos.
- No uses emojis ni signos de exclamación múltiples.
- No incluyas saludos al lector ("Hola a todos") ni cierres tipo "lo recomiendo encarecidamente".

Devuelve SOLO el texto de la reseña, sin comillas, sin comentarios, sin encabezados.`;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "anon";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Demasiadas solicitudes. Espera un minuto." } },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "bad_input", message: parsed.error.message } },
      { status: 400 }
    );
  }

  const business = await prisma.voiceBusiness.findFirst({
    where: { slug: parsed.data.slug }
  });
  if (!business) {
    return NextResponse.json({ error: { code: "not_found", message: "Negocio no encontrado" } }, { status: 404 });
  }

  const system = business.customPrompt && business.customPrompt.trim().length > 0
    ? business.customPrompt
    : defaultSystemPrompt(business.name, business.location);
  const userMsg = `Esto ha dicho el cliente en su grabación:\n\n"${parsed.data.transcript}"`;

  try {
    let review = "";
    if (business.aiProvider === "openai") {
      review = await openaiChatCompletion({
        workspaceId: business.workspaceId,
        model: "gpt-4o-mini",
        prompt: `${system}\n\n${userMsg}`,
        temperature: 0.7,
        maxTokens: 600
      });
    } else {
      review = await complete({
        workspaceId: business.workspaceId,
        system,
        user: userMsg,
        maxTokens: 600
      });
    }
    if (!review) {
      return NextResponse.json(
        { error: { code: "empty_review", message: "El borrador ha venido vacío" } },
        { status: 502 }
      );
    }
    const googleUrl = business.googleUrl ?? "";
    const trustpilotUrl = business.trustpilotUrl ?? "";
    return NextResponse.json({
      review: review.trim(),
      googleUrl,
      trustpilotUrl
    });
  } catch (e: any) {
    if (e instanceof AIDisabledError) {
      return NextResponse.json({ error: { code: "ai_disabled", message: e.message } }, { status: 503 });
    }
    return NextResponse.json(
      { error: { code: "draft_error", message: String(e.message ?? e).slice(0, 200) } },
      { status: 502 }
    );
  }
}
