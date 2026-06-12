/**
 * POST /api/v1/leads/[id]/bubui-pitch
 *
 * Genera un mensaje de WhatsApp personalizado que vende Bubui al lead,
 * usando sus datos de Google (nombre, nota, nº de reseñas, ciudad, sector) y
 * enlazando a una demo pública de cómo se vería SU negocio en Bubui
 * (/bubui/demo/<leadId>). Convierte el scraping frío en venta product-led.
 *
 * Devuelve { message, demoUrl }. No envía nada: el mensaje se revisa y se
 * encola/manda desde la UI como cualquier otro.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { complete, AIDisabledError } from "@/lib/ai/anthropic";

export const dynamic = "force-dynamic";

const SYSTEM = `Eres un comercial cercano de Negocio Vivo que capta negocios locales para Bubui,
una app de fidelización: los clientes escanean el ticket, se llevan descuentos y, sobre todo,
TRAEN AMIGOS (mecánica viral: una oferta mayor que se desbloquea al invitar a 5 amigos) y dejan
reseñas de 5★ en Google. El resultado para el negocio: clientes que repiten, boca a boca real y
mejor reputación en Google.

Escribe un primer mensaje de WhatsApp para el dueño del negocio. Reglas:
- Español de España, cercano y natural. Nada de "Estimado" ni formalismos rancios.
- Engancha en la primera línea con un dato REAL suyo de Google (su nota y/o nº de reseñas, su ciudad).
- Explica en 1-2 frases el beneficio concreto (clientes que vuelven + traen amigos + más reseñas 5★).
- Incluye el enlace a la demo TAL CUAL te lo paso, en su propia línea, presentándolo como
  "mira cómo quedaría tu negocio en Bubui".
- Termina con una CTA fácil ("¿te paso 2 ejemplos?", "¿te llamo 5 min mañana?", varía).
- Máximo ~5 líneas cortas, separadas por líneas en blanco. Máximo 1 emoji, nunca al principio.
- No inventes datos que no te doy. Devuelve SOLO el mensaje, sin comillas ni notas.`;

export const POST = withApi({ scope: "*" }, async (req, { api, params }) => {
  const lead = await prisma.lead.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: {
      id: true,
      name: true,
      province: true,
      category: true,
      rating: true,
      reviewsCount: true
    }
  });
  if (!lead) throw new ApiError(404, "not_found", "Lead no encontrado");

  const origin = new URL(req.url).origin;
  const demoUrl = `${origin}/bubui/demo/${lead.id}`;

  const datos = [
    `Negocio: ${lead.name}`,
    lead.province ? `Zona: ${lead.province}` : null,
    lead.category ? `Sector: ${lead.category}` : null,
    lead.rating != null ? `Nota en Google: ${lead.rating}` : null,
    lead.reviewsCount ? `Reseñas en Google: ${lead.reviewsCount}` : null,
    `Enlace demo (usar tal cual): ${demoUrl}`
  ]
    .filter(Boolean)
    .join("\n");

  let message: string;
  try {
    message = await complete({
      workspaceId: api.workspaceId,
      model: "claude-haiku-4-5-20251001",
      system: SYSTEM,
      user: `Escribe el mensaje para este negocio:\n\n${datos}`,
      maxTokens: 500,
      feature: "leads.bubui_pitch"
    });
    message = message.trim().replace(/^["']|["']$/g, "");
  } catch (e) {
    if (e instanceof AIDisabledError) {
      throw new ApiError(503, "ai_disabled", "La IA no está configurada en este workspace.");
    }
    throw e;
  }

  // Garantía: el enlace de la demo SIEMPRE va, aunque la IA lo omita.
  if (!message.includes(demoUrl)) {
    message = `${message}\n\nMira cómo quedaría tu negocio en Bubui:\n${demoUrl}`;
  }

  return NextResponse.json({ message, demoUrl });
});
