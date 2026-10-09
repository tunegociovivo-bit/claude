/**
 * POST /api/v1/gmb/clients/[id]/qa/suggest { question? } — sugerencias de Preguntas y respuestas
 * con IA a partir de los datos reales de la ficha (nombre, categoría, descripción, dirección, web,
 * teléfono) y de lo que cuentan sus reseñas. Con `question` responde esa pregunta; sin ella propone
 * 5 preguntas frecuentes nuevas con su respuesta. No guarda nada. Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { getOpenAiKeyForWorkspace } from "@/lib/ai/openai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi({ scope: "ai", rate: "ai" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => ({}));
  const question = String(body?.question ?? "").trim().slice(0, 300);
  const c = await prisma.gmbClient.findFirst({ where: { id: (params as any).id, workspaceId: api.workspaceId } });
  if (!c) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const [existing, reviews] = await Promise.all([
    prisma.gmbQa.findMany({ where: { workspaceId: api.workspaceId, clientId: c.id }, select: { question: true }, take: 50 }),
    prisma.gmbReview.findMany({
      where: { workspaceId: api.workspaceId, clientId: c.id, NOT: { comment: "" } },
      orderBy: { reviewTime: "desc" },
      select: { rating: true, comment: true },
      take: 25
    })
  ]);

  const facts = [
    `Negocio: ${c.name}`,
    c.category && `Categoría: ${c.category}`,
    c.description && `Descripción: ${c.description.slice(0, 1200)}`,
    c.address && `Dirección: ${c.address}`,
    c.phone && `Teléfono: ${c.phone}`,
    c.website && `Web: ${c.website}`,
    c.mainKeyword && `Servicio principal: ${c.mainKeyword}`
  ]
    .filter(Boolean)
    .join("\n");
  const reviewText = reviews.map((r) => `- (${r.rating}★) ${String(r.comment).slice(0, 300)}`).join("\n");

  const system =
    "Redactas Preguntas y respuestas para la ficha de Google Business Profile de un negocio local, en español de España. " +
    "Respuestas claras, útiles y breves (25-70 palabras), en nombre del negocio («nosotros»). " +
    "Usa SOLO los datos proporcionados: si un dato concreto (precio, horario, plazo) no aparece, no lo inventes; invita a llamar o a escribir. " +
    "Incluye de forma natural el servicio o la zona cuando encaje (ayuda al SEO local), sin repetir palabras clave de forma forzada. " +
    'Devuelve SOLO JSON: {"items":[{"question":"…","answer":"…"}]}.';
  const user = question
    ? `${facts}\n\nLo que dicen los clientes en sus reseñas:\n${reviewText || "(sin reseñas)"}\n\nResponde a esta pregunta (devuelve 1 item con la misma pregunta, corrigiendo la ortografía si hace falta): ${question}`
    : `${facts}\n\nLo que dicen los clientes en sus reseñas:\n${reviewText || "(sin reseñas)"}\n\nPreguntas que YA existen (no las repitas):\n${existing.map((e) => `- ${e.question}`).join("\n") || "(ninguna)"}\n\nPropón 5 preguntas frecuentes que haría un cliente antes de contratar o visitar este negocio, con su respuesta.`;

  let apiKey: string;
  try {
    apiKey = await getOpenAiKeyForWorkspace(api.workspaceId);
  } catch (e: any) {
    throw new ApiError(400, "no_openai_key", String(e?.message ?? e));
  }
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(55_000),
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });
  if (!resp.ok) throw new ApiError(502, "ai_error", `OpenAI ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
  const data = await resp.json();
  let items: { question: string; answer: string }[] = [];
  try {
    items = (JSON.parse(data?.choices?.[0]?.message?.content ?? "{}").items ?? [])
      .map((x: any) => ({ question: String(x?.question ?? "").trim().slice(0, 300), answer: String(x?.answer ?? "").trim().slice(0, 1500) }))
      .filter((x: any) => x.question && x.answer);
  } catch {
    items = [];
  }
  if (!items.length) throw new ApiError(502, "ai_error", "La IA no devolvió sugerencias. Inténtalo de nuevo.");
  return NextResponse.json({ ok: true, items });
});
