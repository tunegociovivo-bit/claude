/**
 * Generación de un MES COMPLETO de publicaciones con Claude.
 * Equivalente al `generar-mes-ai` del plugin NV Dashboard WP.
 *
 * Input:
 *   { clientId, month: "YYYY-MM", networks: ["instagram", ...], count?: 8, brief?: string }
 *
 * Comportamiento:
 *   - Llama a Claude con un system prompt para el cliente
 *   - Recibe JSON con array de N publicaciones { date, title, content, format, networks }
 *   - Crea las publicaciones en estado DRAFT
 *   - Devuelve { created: [...] }
 *
 * Solo miembros del workspace.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { complete, AIDisabledError } from "@/lib/ai/anthropic";

const inputSchema = z.object({
  clientId: z.string(),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Formato YYYY-MM requerido"),
  networks: z.array(z.string()).default(["instagram"]),
  count: z.number().int().min(1).max(31).default(8),
  brief: z.string().optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const { clientId, month, networks, count, brief } = parsed.data;

  const client = await prisma.client.findFirst({
    where: { id: clientId, workspaceId: api.workspaceId }
  });
  if (!client) throw new ApiError(404, "client_not_found", "Cliente no encontrado");

  const [y, m] = month.split("-").map(Number);
  const monthStart = new Date(Date.UTC(y, m - 1, 1));
  const monthEnd = new Date(Date.UTC(y, m, 0));
  const daysInMonth = monthEnd.getUTCDate();

  // Distribuir N publicaciones uniformemente por el mes
  const dayStep = Math.max(1, Math.floor(daysInMonth / count));
  const targetDays: number[] = [];
  for (let i = 0; i < count; i++) {
    const d = Math.min(daysInMonth, 1 + i * dayStep);
    if (!targetDays.includes(d)) targetDays.push(d);
  }

  const system = `Eres el redactor estrella de la agencia de marketing Negocio Vivo, redactando contenido para el cliente "${client.name}"${client.industry ? ` (sector: ${client.industry})` : ""}.

REGLAS:
- Genera EXACTAMENTE ${count} publicaciones para el mes ${month}.
- Cada publicación tiene un título corto (max 80 chars) y un cuerpo de 80-200 palabras adaptado a las redes ${networks.join(", ")}.
- Variedad de formatos: alterna entre "post", "reel", "story", "carousel".
- Tono natural, sin clichés de marketing, sin emojis múltiples, sin exclamaciones excesivas.
- Si el cliente tiene notas: "${(client.notes ?? "").slice(0, 500)}"
${brief ? `- Brief específico del usuario: ${brief}` : ""}

Devuelve SOLO un JSON válido con esta forma exacta (sin texto antes/después):
{
  "publications": [
    { "dayOfMonth": 3, "title": "...", "format": "post", "content": "..." },
    ...
  ]
}`;

  const userMsg = `Genera ${count} publicaciones para el mes ${month}. Para los días: ${targetDays.join(", ")}.`;

  let raw: string;
  try {
    raw = await complete({
      workspaceId: api.workspaceId,
      userId: api.userId ?? null,
      feature: "editorial_generate_month",
      system,
      user: userMsg,
      maxTokens: 4000
    });
  } catch (e: any) {
    if (e instanceof AIDisabledError) {
      throw new ApiError(503, "ai_disabled", e.message);
    }
    throw new ApiError(502, "ai_error", String(e?.message ?? e).slice(0, 200));
  }

  // Parsear JSON (con tolerancia a wrapping markdown)
  let parsedJson: any;
  try {
    const clean = raw.replace(/```json\n?|```\n?/g, "").trim();
    parsedJson = JSON.parse(clean);
  } catch {
    throw new ApiError(502, "bad_ai_response", "La IA no devolvió JSON parseable");
  }

  const items = Array.isArray(parsedJson.publications) ? parsedJson.publications : [];

  const created = await prisma.$transaction(
    items.slice(0, count).map((item: any, idx: number) => {
      const day = Math.min(daysInMonth, Math.max(1, Number(item.dayOfMonth) || targetDays[idx] || idx + 1));
      const scheduled = new Date(Date.UTC(y, m - 1, day, 10, 0, 0));
      return prisma.editorialPost.create({
        data: {
          workspaceId: api.workspaceId,
          clientId: client.id,
          title: String(item.title ?? `Publicación ${idx + 1}`).slice(0, 200),
          content: String(item.content ?? ""),
          format: ["post", "reel", "story", "video", "blog", "email", "carousel"].includes(item.format)
            ? item.format
            : "post",
          status: "DRAFT",
          scheduledFor: scheduled,
          networks: JSON.stringify(networks),
          mediaUrls: JSON.stringify([])
        }
      });
    })
  );

  return NextResponse.json({ ok: true, created: created.length, items: created });
});
