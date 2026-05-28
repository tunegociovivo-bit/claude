/**
 * POST /api/bubui/ai-studio/push-copy
 *
 * "Vivo Studio" — Claude redacta 3 variantes de copy para un Push del Día
 * a partir de un brief mínimo del dueño:
 *   { businessId, productOrOffer, vibe? }
 *
 * Devuelve 3 variantes con título + body + ángulo emocional + horario
 * sugerido. El dueño elige una y la pasa al checkout normal.
 *
 * Diseño:
 *   - Variante A: urgencia ("Solo hoy", "hasta agotar")
 *   - Variante B: descubrimiento ("Lo nuevo que nadie te dijo")
 *   - Variante C: prueba social ("Lo que más se canjea en {ciudad}")
 *
 * Cero coste si AI no configurada → devolvemos 3 plantillas básicas.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const schema = z.object({
  businessId: z.string().min(1),
  productOrOffer: z.string().min(3).max(220),
  vibe: z.enum(["cercano", "directo", "premium", "divertido"]).optional().default("cercano")
});

const SCHEMA = {
  type: "object",
  properties: {
    variantes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          angulo: { type: "string" },
          titulo: { type: "string" },
          body: { type: "string" },
          horarioSugerido: { type: "string" }
        },
        required: ["angulo", "titulo", "body", "horarioSugerido"]
      }
    }
  },
  required: ["variantes"]
};

const TONE_HINT: Record<string, string> = {
  cercano: "cálido, casi como hablándole a un vecino",
  directo: "claro, conciso, sin rodeos",
  premium: "elegante, foco en calidad y exclusividad",
  divertido: "con humor y guiño, energético"
};

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  }
  const business = await prisma.bubuiBusiness.findUnique({ where: { id: parsed.data.businessId } });
  if (!business) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }

  // Si no hay AI configurada, devuelve plantillas estáticas.
  try {
    const { completeJson } = await import("@/lib/ai/anthropic");
    const system = `Eres copywriter especializado en notificaciones push para negocios locales en España.
Redacta 3 variantes con ángulos diferentes para un push de 24h del negocio "${business.name}" (${business.category}) en ${business.city}.

Reglas estrictas:
- Variante A: ángulo URGENCIA ("solo hoy", "hasta agotar", "últimas horas").
- Variante B: ángulo DESCUBRIMIENTO / NOVEDAD (despierta curiosidad).
- Variante C: ángulo PRUEBA SOCIAL ("lo que más piden", "los clientes Bubui están eligiendo…").
- Cada título: máximo 50 caracteres, llamativo, EN MAYÚSCULAS solo la primera letra.
- Cada body: 1-2 frases, máximo 120 caracteres, CTA implícita.
- Tono: ${TONE_HINT[parsed.data.vibe]}.
- Horario sugerido: una franja concreta (ej: "12:00-14:00 (hora de comer)", "18:00-20:00 (after-work)", "19:30-21:30 (cena)") basada en lo que tendría más sentido para "${business.category}".
- Cero emojis al inicio del título. Máximo 1 emoji al final del body si encaja.
- No inventes datos: usa solo la oferta que te dan.

Devuelve SIEMPRE el JSON pedido con 3 variantes.`;

    const user = `Negocio: ${business.name} (${business.category}, ${business.city})
Oferta a promocionar: ${parsed.data.productOrOffer}
Tono: ${parsed.data.vibe}`;

    const data = await completeJson<{ variantes: Array<{ angulo: string; titulo: string; body: string; horarioSugerido: string }> }>({
      workspaceId: "bubui-system", // workspaceId ficticio — fallback a env OPENAI_API_KEY si no hay ai key per-workspace
      model: "claude-haiku-4-5-20251001",
      system,
      user,
      schema: SCHEMA,
      maxTokens: 1200
    });
    return NextResponse.json({ ok: true, variantes: data.variantes ?? [] });
  } catch (e: any) {
    // Fallback con plantillas estáticas si la IA no está disponible.
    console.warn("[bubui ai-studio] fallback:", e?.message ?? e);
    const off = parsed.data.productOrOffer;
    return NextResponse.json({
      ok: true,
      aiDisabled: true,
      variantes: [
        {
          angulo: "Urgencia",
          titulo: `Hoy en ${business.name}`,
          body: `Solo durante hoy: ${off.slice(0, 100)}`,
          horarioSugerido: "11:00-13:00"
        },
        {
          angulo: "Descubrimiento",
          titulo: `Nuevo en ${business.name}`,
          body: `${off.slice(0, 100)} — pásate cuando puedas.`,
          horarioSugerido: "17:00-19:00"
        },
        {
          angulo: "Prueba social",
          titulo: `Lo que se está pidiendo`,
          body: `Los clientes de ${business.city} están eligiendo: ${off.slice(0, 80)}.`,
          horarioSugerido: "19:00-21:00"
        }
      ]
    });
  }
}
