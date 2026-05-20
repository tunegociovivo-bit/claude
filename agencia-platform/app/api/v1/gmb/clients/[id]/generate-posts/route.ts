/**
 * POST /api/v1/gmb/clients/[id]/generate-posts → genera publicaciones con IA
 * Body: { count? }  Devuelve { posts: [{ title, content, cta }] } (no las guarda).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { openaiChatCompletion } from "@/lib/ai/openai";

export const dynamic = "force-dynamic";

const schema = z.object({ count: z.number().int().min(1).max(7).optional() });

export const POST = withApi({ scope: "ai", rate: "ai" }, async (req, { params, api }) => {
  const client = await prisma.gmbClient.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { name: true, mainKeyword: true, category: true, description: true }
  });
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  const count = parsed.success ? parsed.data.count ?? 3 : 3;

  let prompt = `Genera ${count} publicaciones para el perfil de Google Business del negocio "${client.name}"`;
  if (client.mainKeyword) prompt += ` (palabra clave: ${client.mainKeyword})`;
  if (client.category) prompt += ` (categoría: ${client.category})`;
  prompt +=
    ". Cada publicación debe tener un título corto, contenido de 2-3 frases y un CTA (llamada a la acción). En español, tono profesional y cercano, sin hashtags ni emojis. " +
    'Responde SOLO un array JSON válido, sin markdown ni texto extra. Formato: [{"title":"...","content":"...","cta":"..."}]';

  let text = "";
  try {
    text = await openaiChatCompletion({
      workspaceId: api.workspaceId,
      model: "gpt-4o-mini",
      prompt,
      temperature: 0.7,
      maxTokens: 1500,
      userId: api.userId,
      feature: "gmb_generate_posts"
    });
  } catch (e: any) {
    throw new ApiError(502, "ai_error", String(e?.message ?? e));
  }

  const posts = parseJsonArray(text);
  return NextResponse.json({ posts });
});

function parseJsonArray(text: string): Array<{ title: string; content: string; cta: string }> {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
  try {
    const arr = JSON.parse(t);
    if (Array.isArray(arr)) {
      return arr
        .filter((p) => p && typeof p === "object")
        .map((p: any) => ({
          title: String(p.title ?? "").slice(0, 200),
          content: String(p.content ?? "").slice(0, 1500),
          cta: String(p.cta ?? "").slice(0, 200)
        }));
    }
  } catch {}
  return [];
}
