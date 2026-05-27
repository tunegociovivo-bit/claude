/**
 * Endpoint público para generar una reseña.
 * Acepta { slug } y devuelve { body, destinationUrl }.
 *
 * Es PÚBLICO (sin auth) porque lo llama el widget embebido en webs externas.
 * Mitigación: rate limit muy simple en memoria + límite de longitud.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { openaiChatCompletion } from "@/lib/ai/openai";
import { AIDisabledError } from "@/lib/ai/anthropic";

const inputSchema = z.object({
  slug: z.string().min(1).max(80)
});

// Rate limit muy básico en memoria (process-local). Para multi-réplica
// habría que migrar a Redis.
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 10;
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
      { error: { code: "rate_limited", message: "Demasiadas solicitudes. Vuelve en un minuto." } },
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

  const client = await prisma.reviewClient.findFirst({
    where: { slug: parsed.data.slug },
    include: { history: { take: 1, orderBy: { createdAt: "desc" } } }
  });
  if (!client) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Cliente no encontrado" } },
      { status: 404 }
    );
  }

  // Construcción del prompt — mismo espíritu que el plugin WP
  const topicsArr = client.topics.split("\n").map((s) => s.trim()).filter(Boolean);
  const topic = topicsArr.length > 0 ? topicsArr[Math.floor(Math.random() * topicsArr.length)] : "Experiencia general";
  const previous = client.history[0]?.body ?? "";
  const lengthHint = previous.length < 120
    ? "Escribe unas 4 líneas detalladas."
    : "Sé muy breve (máx 12 palabras).";

  let prompt = `Actúa como cliente real de ${client.name}. Escribe una reseña.\n`;
  prompt += `TEMA: ${topic}.\n`;
  prompt += `LONGITUD: ${lengthHint}\n`;
  if (client.bannedWords) prompt += `PROHIBIDO usar: ${client.bannedWords}.\n`;
  if (client.recommendedWords) prompt += `INTENTA usar alguna de estas expresiones: ${client.recommendedWords}.\n`;
  if (client.extraInstructions) prompt += client.extraInstructions;

  let reviewBody = "Todo perfecto, recomendado.";
  try {
    const generated = await openaiChatCompletion({
      workspaceId: client.workspaceId,
      model: client.model,
      prompt,
      temperature: 1.1,
      presencePenalty: 2.0,
      maxTokens: 400
    });
    if (generated) {
      reviewBody = generated.replace(/[""""]/g, "").trim();
      // Persistimos historial para que el siguiente prompt varíe la longitud
      await prisma.reviewHistory.create({
        data: { clientId: client.id, body: reviewBody }
      });
    }
  } catch (e: any) {
    if (e instanceof AIDisabledError) {
      return NextResponse.json(
        { error: { code: "ai_disabled", message: e.message } },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: { code: "openai_error", message: String(e.message ?? e).slice(0, 200) } },
      { status: 502 }
    );
  }

  return NextResponse.json({
    body: reviewBody,
    destinationUrl: client.destinationUrl
  });
}
